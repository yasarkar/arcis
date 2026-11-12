// Renders Copilot message HTML with inline network badges.
//
// Copilot templates mark a network with `[[network:<chain name>]]` (see
// src/utils/sanitizeCopilotHtml.ts). Because message bodies are inserted with
// dangerouslySetInnerHTML, a network icon cannot be part of the HTML string — it must be a React
// component. This component splits the content on the marker and mounts a real @web3icons chain
// badge in its place, sanitizing each HTML segment independently.
import React from 'react'
import { splitCopilotNetworkSegments } from '../../utils/sanitizeCopilotHtml'
import { CopilotNetworkBadge, CopilotTokenIcon } from './CopilotTokenIcon'

interface CopilotMessageContentProps {
  content: string
  className?: string
}

export function CopilotMessageContent({ content, className = '' }: CopilotMessageContentProps) {
  const segments = splitCopilotNetworkSegments(content)

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === 'network') {
          return <CopilotNetworkBadge key={index} chainName={segment.value} className="align-middle mx-0.5" />
        }
        if (segment.type === 'token') {
          return (
            <span key={index} className="inline-flex items-center align-middle mx-1 -mt-0.5">
              <CopilotTokenIcon symbol={segment.value} className="w-4 h-4 object-contain inline-block" />
            </span>
          )
        }
        return <span key={index} dangerouslySetInnerHTML={{ __html: segment.value }} />
      })}
    </span>
  )
}

export default CopilotMessageContent
