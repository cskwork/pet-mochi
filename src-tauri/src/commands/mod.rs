//! REQ-124.3 — commands split by domain. Pure move from the former flat
//! `commands.rs`; every path in `lib.rs`'s `generate_handler!` keeps
//! compiling via the re-exports below. Shared helpers live in their owning
//! domain module (`state.rs` for settings/pet-state plumbing, `chat.rs` for
//! LLM text/JSON helpers) and are `pub(crate)` where a sibling needs them.

mod chat;
mod inbox;
mod memory;
mod reports;
mod state;

// Glob re-exports: `tauri::generate_handler!` resolves hidden `__cmd__*`
// marker items alongside each command path, and those markers do not travel
// through named `pub use` lists. Re-exporting the modules themselves keeps
// every `commands::` path in `lib.rs` compiling while preserving the markers.
pub use chat::*;
pub use inbox::*;
pub use memory::*;
pub use reports::*;
pub use state::*;
