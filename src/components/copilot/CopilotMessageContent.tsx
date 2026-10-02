// Renders Copilot message HTML with inline network badges.
//
// Copilot templates mark a network with `[[network:<chain name>]]` (see
// src/utils/sanitizeCopilotHtml.ts). Because message bodies are inserted with
// dangerouslySetInnerHTML, a network icon cannot be part of the HTML string — it must be a React
// component. This component splits the content on the marker and mounts a real @web3icons chain
// badge in its place, sanitizing each HTML segment independently.
import React from 'react'
import { splitCopilotNetworkSegments } from '../../utils/sanitizeCopilotHtml'
import { CopilotNetworkBadge } from './CopilotTokenIcon'

interface CopilotMessageContentProps {
  content: string
  className?: string
}

export function CopilotMessageContent({ content, className = '' }: CopilotMessageContentProps) {
  const segments = splitCopilotNetworkSegments(content)

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.type === 'network' ? (
          <CopilotNetworkBadge key={index} chainName={segment.value} className="align-middle mx-0.5" />
        ) : (
          <span key={index} dangerouslySetInnerHTML={{ __html: segment.value }} />
        )
      )}
    </span>
  )
}

export default CopilotMessageContent
