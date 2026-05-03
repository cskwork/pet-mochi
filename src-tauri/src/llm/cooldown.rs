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

    /// Regression: concurrent try_acquire calls on the same key must serialize
    /// such that exactly ONE wins inside the cooldown window. If the inner
    /// check+insert ever stops being atomic, this fires intermittently — but
    /// 32 threads makes the race extremely likely to land.
    #[test]
    fn concurrent_acquires_only_one_wins() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        use std::thread;

        let cd = Arc::new(CooldownManager::new());
        let wins = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..32 {
            let cd = cd.clone();
            let wins = wins.clone();
            handles.push(thread::spawn(move || {
                if cd.try_acquire("llm_autonomous", Duration::from_secs(60)) {
                    wins.fetch_add(1, Ordering::SeqCst);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(wins.load(Ordering::SeqCst), 1);
    }
}
