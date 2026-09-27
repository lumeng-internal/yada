import {
  conversationIdFromUrl as conversationIdFromLocation,
  isChatGptConversationUrl,
  isChatGptPageUrl
} from "./conversationUrl";
import { conversationDomId } from "./pageFacts";

export {
  conversationIdFromUrl as conversationIdFromLocation,
  isChatGptConversationUrl,
  isChatGptPageUrl
} from "./conversationUrl";
export {
  collectCompletedAssistantIds,
  collectPageMessages,
  conversationScroller,
  conversationSurface,
  exposePaginationSentinel,
  findNativeActionGroup,
  isGenerating,
  readGenerationState,
  readOfficialNavigator,
  readingPositionDrift,
  safeDesktopLayout,
  saveReadingPosition,
  stableLayoutAvailable,
  type NativePromptState,
  type ReadingPosition
} from "./pageFacts";

export function isChatGptPage(url = window.location.href): boolean {
  return isChatGptPageUrl(url);
}

export function getConversationIdFromUrl(url = window.location.href): string | null {
  return conversationIdFromLocation(url) ?? conversationDomId();
}

export function isChatGptConversationPage(url = window.location.href): boolean {
  return isChatGptConversationUrl(url) || (isChatGptPage(url) && getConversationIdFromUrl(url) !== null);
}
