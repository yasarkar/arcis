import React from 'react'
import {
  FeeBreakdownCard,
  type FeeBreakdownItem,
  type FeeBreakdownCardProps,
} from '../common/FeeBreakdownCard'

export type BreakdownItem = FeeBreakdownItem

export interface TransactionBreakdownProps extends FeeBreakdownCardProps {
  summaryTitle: string
}

export const TransactionBreakdown: React.FC<TransactionBreakdownProps> = (props) => {
  return <FeeBreakdownCard {...props} />
}

export default TransactionBreakdown
