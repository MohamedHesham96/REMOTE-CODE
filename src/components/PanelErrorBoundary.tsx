import { Component, type ReactNode } from "react"
import type { Strings } from "../i18n"

interface PanelErrorBoundaryProps {
  children: ReactNode
  onClose: () => void
  t: Strings
  panelName: string
}

interface PanelErrorBoundaryState {
  error: Error | null
}

// error boundary لكل لوحات الـ Suspense — أخطاء الرسم في أي درج كانت
// بتطفّي التطبيق كله. ده بيمسك الخطأ، يعرض زر "إغلاق"، ويخلّي باقي
// الواجهة شغّالة. الـ panelName بيظهر في الـ UI للسماح للمطور بتحديد
// المشكلة من اسم المكوّن.
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  override state: PanelErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // الـ console.error كافي للتشخيص — التطبيق لا يرسل telemetry.
    console.error(`[PanelErrorBoundary] ${this.props.panelName}:`, error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error) {
      return (
        <div className="warning-box panel-error-fallback" role="alert">
          <strong>{this.props.t.panelLoadFailed}</strong>
          <div>{error.message}</div>
          <button className="button button-secondary" onClick={this.props.onClose}>{this.props.t.close}</button>
        </div>
      )
    }
    return this.props.children
  }
}
