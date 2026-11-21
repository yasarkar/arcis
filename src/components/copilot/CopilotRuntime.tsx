import { Suspense, type ComponentType } from 'react'
import CopilotRobotWidget from './CopilotRobotWidget'
import { useArcCopilot } from '../../hooks/useArcCopilot'
import { SectionErrorBoundary } from '../common/GlobalErrorBoundary'
import type { CopilotUcwHandlers } from '../../services/copilotExecutionService'

export interface CopilotRuntimeProps {
  walletAddress: string
  connectedProvider: any
  activeAuthSource: 'passkey' | 'ucw' | 'evm' | null
  ucwAddress: string
  executeUcwTransfer?: CopilotUcwHandlers['executeUcwTransfer']
  executeUcwContract?: CopilotUcwHandlers['executeUcwContract']
  pollUcwChallengeTx?: CopilotUcwHandlers['pollChallengeTx']
  executeUcwSignTypedData?: CopilotUcwHandlers['signTypedData']
  onNavigateToTab: (tab: string) => void
  DrawerComponent: ComponentType<any>
}

export default function CopilotRuntime({
  walletAddress,
  connectedProvider,
  activeAuthSource,
  ucwAddress,
  executeUcwTransfer,
  executeUcwContract,
  pollUcwChallengeTx,
  executeUcwSignTypedData,
  onNavigateToTab,
  DrawerComponent,
}: CopilotRuntimeProps) {
  const copilot = useArcCopilot(
    walletAddress,
    connectedProvider,
    {
      authSource: activeAuthSource,
      executeUcwTransfer,
      executeUcwContract,
      signTypedData: executeUcwSignTypedData,
      pollChallengeTx: pollUcwChallengeTx,
    },
    true
  )

  return (
    <>
      <CopilotRobotWidget
        isOpen={copilot.isOpen}
        onClick={copilot.toggleOpen}
        isAnalyzing={copilot.isAnalyzing}
      />

      <SectionErrorBoundary title="Arco AI Copilot is temporarily unavailable">
        {copilot.isOpen && (
          <Suspense fallback={null}>
            <DrawerComponent
              isOpen={copilot.isOpen}
              onClose={() => copilot.setIsOpen(false)}
              messages={copilot.messages}
              currentSteps={copilot.currentSteps}
              isAnalyzing={copilot.isAnalyzing}
              sessionConfig={copilot.sessionConfig}
              walletAddress={walletAddress || ucwAddress}
              provider={connectedProvider}
              ucwHandlers={{
                executeUcwTransfer,
                executeUcwContract,
                pollChallengeTx: pollUcwChallengeTx,
                signTypedData: executeUcwSignTypedData,
                authSource: activeAuthSource,
              }}
              authSource={activeAuthSource}
              onSendMessage={copilot.executeQuery}
              onClearChat={copilot.clearChat}
              onActivateSession={copilot.activateSession}
              onRevokeSession={copilot.revokeSession}
              onToggleAutoExecute={copilot.toggleAutoExecute}
              onExecuteInline={copilot.executeInlineAction}
              onExecuteNextStep={copilot.executeNextStep}
              canExecuteNextStep={copilot.canExecuteNextStep}
              canPayForCalls={copilot.canPayForCalls}
              onNavigateToTab={(tab: string) => onNavigateToTab(tab as any)}
            />
          </Suspense>
        )}
      </SectionErrorBoundary>
    </>
  )
}
