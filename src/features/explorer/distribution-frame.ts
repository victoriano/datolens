import type { DesktopApi, Distributions } from '../../contracts/desktop-api';
import { mergeDistributions } from './distributions';
import { shareDistribution } from './distribution-sharing';

export interface DistributionFrame {
  api: DesktopApi;
  source: string;
  context: string;
  filtered: boolean;
  result: Distributions;
}

/** Replace a filtered viewport in one frame; never mix populations or clear mounted charts. */
export function nextDistributionFrame(previous: DistributionFrame | null, request: Omit<DistributionFrame, 'result'>, incoming: Distributions, columns: string[]): DistributionFrame {
  const compatible = previous?.api === request.api && previous.source === request.source;
  if (compatible && previous.context !== request.context && !incoming.deferredReason) {
    const ready = new Set(incoming.variables.map(variable => variable.column));
    if (columns.some(id => !ready.has(id))) return previous;
  }
  const sameContext = compatible && previous.context === request.context;
  if (compatible && !incoming.deferredReason) {
    const byColumn = new Map(previous.result.variables.map(variable => [variable.column, variable]));
    incoming = { ...incoming, variables: incoming.variables.map(variable => shareDistribution(byColumn.get(variable.column), variable)) };
  }
  const result = mergeDistributions(sameContext ? previous.result : null, incoming);
  return sameContext && result === previous.result ? previous : { ...request, result };
}
