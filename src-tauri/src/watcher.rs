use crate::error::AppResult;
use crate::sandbox::list_inbox;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxFileFoundEvent {
    pub name: String,
}

/// Background watcher handle. Drop this to signal shutdown and join the worker.
pub struct WatcherHandle {
    shutdown: std::sync::mpsc::Sender<()>,
    join: Option<JoinHandle<()>>,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        let _ = self.shutdown.send(());
        if let Some(j) = self.join.take() {
            // Give the worker up to 1s to exit. Joining beyond that risks
            // blocking shutdown — log and let the OS reclaim the thread.
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = j.join();
                let _ = tx.send(());
            });
            let _ = rx.recv_timeout(Duration::from_secs(1));
        }
    }
}

/// Spawn a background thread that watches the inbox for new files and emits
/// `inbox:file-found` events on the tauri app handle. Returns a handle whose
/// drop signals shutdown and joins the worker.
pub fn spawn_inbox_watcher(app: AppHandle, home: PathBuf) -> AppResult<WatcherHandle> {
    let inbox = home.join("inbox");
    std::fs::create_dir_all(&inbox)?;
    let (shutdown_tx, shutdown_rx) = channel::<()>();

    let join = std::thread::spawn(move || {
        let (event_tx, event_rx) = channel();
        let mut watcher = match RecommendedWatcher::new(
            move |res: notify::Result<Event>| {
                let _ = event_tx.send(res);
            },
            Config::default().with_poll_interval(Duration::from_secs(2)),
        ) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("could not create inbox watcher: {e}");
                return;
            }
        };

        if let Err(e) = watcher.watch(&inbox, RecursiveMode::NonRecursive) {
            log::warn!("could not watch inbox: {e}");
            return;
        }

        // Initial scan — emit any pre-existing files so the UI can pick them up.
        if let Ok(files) = list_inbox(&home) {
            for f in files {
                let _ = app.emit("inbox:file-found", InboxFileFoundEvent { name: f.name });
            }
        }

        loop {
            // Check for shutdown signal first.
            match shutdown_rx.try_recv() {
                Ok(()) | Err(std::sync::mpsc::TryRecvError::Disconnected) => return,
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
            }
            match event_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(event)) => match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) => {
                        for path in event.paths {
                            if path.is_file() {
                                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                                    let _ = app.emit(
                                        "inbox:file-found",
                                        InboxFileFoundEvent { name: name.to_string() },
                                    );
                                }
                            }
                        }
                    }
                    _ => {}
                },
                Ok(Err(e)) => log::warn!("watcher error: {e}"),
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    });

    Ok(WatcherHandle {
        shutdown: shutdown_tx,
        join: Some(join),
    })
}
