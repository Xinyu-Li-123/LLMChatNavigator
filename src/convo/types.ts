import type { ConvoTree } from '@/src/shared/types';

export type ConvoMetadata = {
  convoId: string;
  convoTitle: string;
  convoUrl: string;
};

export interface ConvoSnapshot {
  readonly convoMetadata: ConvoMetadata;
  readonly curNodeId: string | null;
  readonly tree: ConvoTree;
}
