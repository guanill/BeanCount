"use client";

import React from "react";

interface Props {
  name: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class TabErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || "Unexpected rendering error",
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[${this.props.name}] render error:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-red/30 bg-card p-6 text-center space-y-3">
          <p className="text-red font-semibold">
            Something went wrong loading {this.props.name}
          </p>
          <p className="text-xs text-foreground/50">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-light transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
