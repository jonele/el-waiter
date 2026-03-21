"use client";
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          minHeight: "100dvh",
          background: "var(--c-bg, #090910)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 16,
          color: "var(--c-text, #fff)",
        }}>
          <p style={{ fontSize: 48 }}>⚠️</p>
          <p style={{ fontSize: 18, fontWeight: 700 }}>Κάτι πήγε στραβά</p>
          <p style={{ fontSize: 13, color: "var(--c-text2, #6b7280)", textAlign: "center", maxWidth: 300 }}>
            {this.state.error?.message || "Άγνωστο σφάλμα"}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              background: "#3B82F6",
              color: "#fff",
              border: "none",
              borderRadius: 14,
              padding: "14px 32px",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Επαναφόρτωση
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
