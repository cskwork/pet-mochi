use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Tracks per-key cooldowns. Used to prevent LLM call spam.
#[derive(Default)]
pub struct CooldownManager {
    inner: Mutex<HashMap<String, Instant>>,
}

impl CooldownManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true if the cooldown has elapsed (or was never set), and updates the timestamp.
    pub fn try_acquire(&self, key: &str, cooldown: Duration) -> bool {
        let mut map = self.inner.lock();
        let now = Instant::now();
        let allowed = match map.get(key) {
            Some(last) => now.duration_since(*last) >= cooldown,
            None => true,
        };
        if allowed {
            map.insert(key.to_string(), now);
        }
        allowed
    }

    /// Check without acquiring.
    pub fn is_ready(&self, key: &str, cooldown: Duration) -> bool {
        let map = self.inner.lock();
        match map.get(key) {
            Some(last) => Instant::now().duration_since(*last) >= cooldown,
            None => true,
        }
    }

    pub fn reset(&self, key: &str) {
        self.inner.lock().remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_acquire_succeeds() {
        let cd = CooldownManager::new();
        assert!(cd.try_acquire("llm", Duration::from_millis(50)));
    }

    #[test]
    fn rapid_second_acquire_fails() {
        let cd = CooldownManager::new();
        assert!(cd.try_acquire("llm", Duration::from_millis(200)));
        assert!(!cd.try_acquire("llm", Duration::from_millis(200)));
    }

    #[test]
    fn after_cooldown_acquire_succeeds() {
        let cd = CooldownManager::new();
        assert!(cd.try_acquire("llm", Duration::from_millis(20)));
        std::thread::sleep(Duration::from_millis(30));
        assert!(cd.try_acquire("llm", Duration::from_millis(20)));
    }

    #[test]
    fn keys_are_independent() {
        let cd = CooldownManager::new();
        assert!(cd.try_acquire("a", Duration::from_secs(60)));
        assert!(cd.try_acquire("b", Duration::from_secs(60)));
        assert!(!cd.try_acquire("a", Duration::from_secs(60)));
    }
}
