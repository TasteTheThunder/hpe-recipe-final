package com.hpe.recipe.service;

import org.eclipse.jgit.transport.PushResult;
import org.eclipse.jgit.transport.RemoteRefUpdate;

final class GitSupport {

    static final Object REMOTE_LOCK = new Object();

    private GitSupport() {
    }

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
