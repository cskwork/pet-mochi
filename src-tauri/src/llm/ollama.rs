use super::provider::{LlmProvider, LlmRequest, LlmResponse};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

pub struct OllamaProvider {
    client: Result<reqwest::Client, reqwest::Error>,
    base_url: String,
    default_model: String,
}

impl OllamaProvider {
    pub fn new(base_url: impl Into<String>, default_model: impl Into<String>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build();
        Self {
            client,
            base_url: base_url.into().trim_end_matches('/').to_string(),
            default_model: default_model.into(),
        }
    }
}

#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: String,
    system: Option<String>,
    stream: bool,
    // Disables reasoning-mode wrapping for "thinking" models (e.g. gemma4:e2b).
    // Without it, Ollama keeps the user-visible `response` empty until the much
    // larger thinking budget is hit. Non-thinking models ignore the field.
    think: bool,
    options: GenerateOptions,
}

#[derive(Serialize, Default)]
struct GenerateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
    #[serde(default)]
    model: String,
}

impl LlmProvider for OllamaProvider {
    fn name(&self) -> &'static str {
        "ollama"
    }

    fn complete<'a>(
        &'a self,
        req: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<LlmResponse>> + Send + 'a>> {
        Box::pin(async move {
            let model = req.model.clone().unwrap_or_else(|| self.default_model.clone());
            let body = GenerateRequest {
                model: &model,
                prompt: req.prompt,
                system: req.system,
                stream: false,
                think: false,
                options: GenerateOptions {
                    temperature: req.temperature,
                    num_predict: req.max_tokens,
                },
            };
            let url = format!("{}/api/generate", self.base_url);
            let client = self
                .client
                .as_ref()
                .map_err(|e| AppError::LlmUnavailable(format!("ollama client initialization failed: {e}")))?;
            let resp = client
                .post(&url)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::LlmUnavailable(format!("ollama request failed: {e}")))?;

            if !resp.status().is_success() {
                let status = resp.status();
                // Capture the response body to the local log only — never surface it
                // to the frontend, since a misconfigured endpoint could inject
                // arbitrary text into a string we'd otherwise render in chat.
                let body = resp.text().await.unwrap_or_default();
                log::warn!("ollama returned {}: {}", status, body);
                return Err(AppError::LlmUnavailable(format!(
                    "ollama responded with status {}",
                    status.as_u16()
                )));
            }

            let parsed: GenerateResponse = resp.json().await.map_err(|e| {
                log::warn!("ollama returned invalid json: {e}");
                AppError::LlmUnavailable("ollama returned an invalid response".into())
            })?;

            Ok(LlmResponse {
                text: parsed.response.trim().to_string(),
                model: if parsed.model.is_empty() { model } else { parsed.model },
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::OllamaProvider;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    #[tokio::test]
    async fn client_does_not_follow_redirects() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let location = format!("{endpoint}/redirected");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = BufReader::new(&mut stream);
            let mut line = String::new();
            loop {
                line.clear();
                assert!(request.read_line(&mut line).unwrap() > 0);
                if line == "\r\n" {
                    break;
                }
            }
            write!(
                stream,
                "HTTP/1.1 307 Temporary Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });

        let provider = OllamaProvider::new(endpoint.clone(), "test-model");
        let response = provider.client.as_ref().unwrap().get(&endpoint).send().await.unwrap();
        server.join().unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(response.url().as_str(), format!("{endpoint}/"));
    }
}
