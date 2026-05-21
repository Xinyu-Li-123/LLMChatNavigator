import type { SupportedPlatform } from '@/src/auth/types';
import type { ConvoSnapshot } from './types';

export interface ConvoController {
  readonly platformName: SupportedPlatform;

  getSnapshot(): ConvoSnapshot | null;

  syncConvo(): Promise<void>;

  navigateToNode(targetNodeId: string): Promise<void>;

  submitReply(parentNodeId: string, text: string): Promise<void>;
}
