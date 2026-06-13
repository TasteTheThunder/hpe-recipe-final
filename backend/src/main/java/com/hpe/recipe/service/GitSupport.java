package com.hpe.recipe.service;

import org.eclipse.jgit.transport.PushResult;
import org.eclipse.jgit.transport.RemoteRefUpdate;

/**
 * Shared coordination for the two Git writers ({@link GitOpsService} and
 * {@link GitStateService}), which push to the SAME remote branch from separate working
 * clones. Without a shared lock + push-result check, a near-simultaneous push from the
 * other writer is rejected (non-fast-forward) and — because JGit's {@code push()} does not
 * throw on rejection — silently lost.
 */
final class GitSupport {

    /**
     * Serializes every push-bearing Git operation across both services so they cannot
     * interleave on the shared remote branch. A single monitor (no nested locks) → no deadlock.
     */
    static final Object REMOTE_LOCK = new Object();

    private GitSupport() {
    }

    /** True only if every remote ref update was accepted (OK or already UP_TO_DATE). */
    static boolean pushAccepted(Iterable<PushResult> results) {
        for (PushResult result : results) {
            for (RemoteRefUpdate update : result.getRemoteUpdates()) {
                RemoteRefUpdate.Status status = update.getStatus();
                if (status != RemoteRefUpdate.Status.OK && status != RemoteRefUpdate.Status.UP_TO_DATE) {
                    return false;
                }
            }
        }
        return true;
    }

    /** Human-readable detail of any rejected ref updates, for error messages/logs. */
    static String pushFailureDetail(Iterable<PushResult> results) {
        StringBuilder sb = new StringBuilder();
        for (PushResult result : results) {
            for (RemoteRefUpdate update : result.getRemoteUpdates()) {
                sb.append(update.getRemoteName()).append('=').append(update.getStatus());
                if (update.getMessage() != null) {
                    sb.append(" (").append(update.getMessage()).append(')');
                }
                sb.append("; ");
            }
        }
        return sb.toString().trim();
    }
}
