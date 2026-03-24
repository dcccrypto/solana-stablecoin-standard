// SSS-139: Invariant monitoring bot
// Modules: invariant_checker, alert_manager, metric_collector

pub mod alert_manager;
pub mod invariant_checker;
pub mod metric_collector;

use crate::state::AppState;

/// Spawn the monitoring service background tasks.
pub fn spawn_monitor(state: AppState) {
    let s1 = state.clone();
    tokio::spawn(async move {
        invariant_checker::run_invariant_checker(s1).await;
    });

    let s2 = state.clone();
    tokio::spawn(async move {
        metric_collector::run_metric_collector(s2).await;
    });
}
