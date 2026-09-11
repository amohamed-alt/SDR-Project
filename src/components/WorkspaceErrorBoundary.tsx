"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { assetRecoveryStorageKey, isRecoverableAssetError } from "@/lib/asset-recovery";
import styles from "@/components/DashboardShell.module.css";

type Props = {
  children: ReactNode;
  onBack: () => void;
};

type State = {
  error: Error | null;
  recovering: boolean;
};

export class WorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, recovering: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Workspace failed to render", error, errorInfo);
    if (!isRecoverableAssetError(error)) return;

    const recoveryKey = assetRecoveryStorageKey(error);
    if (window.sessionStorage.getItem(recoveryKey)) return;

    window.sessionStorage.setItem(recoveryKey, "1");
    this.setState({ recovering: true }, () => window.location.reload());
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <main className={styles.viewError} role="alert">
      <span>{this.state.recovering ? "Loading the latest dashboard version…" : "This workspace could not load."}</span>
      <strong>{this.state.recovering ? "Refreshing safely" : "Your dashboard navigation is still available."}</strong>
      {!this.state.recovering ? <div>
        <button type="button" onClick={() => window.location.reload()}>Reload latest version</button>
        <button type="button" onClick={this.props.onBack}>Back to analytics</button>
      </div> : null}
    </main>;
  }
}
