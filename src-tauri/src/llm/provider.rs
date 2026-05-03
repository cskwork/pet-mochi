use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub system: Option<String>,
    pub prompt: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub text: String,
    pub model: String,
}

/// Provider trait. We use a manual boxed future instead of `async_trait`
/// to keep dependency weight minimal.
pub trait LlmProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn complete<'a>(
        &'a self,
        req: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<LlmResponse>> + Send + 'a>>;
}
