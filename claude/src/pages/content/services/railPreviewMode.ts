export type RailPreviewMode = 'user' | 'userAssistant';

type RailPreviewModeSubscriber = (mode: RailPreviewMode) => void;

let mode: RailPreviewMode = 'user';
const subscribers = new Set<RailPreviewModeSubscriber>();

const notifyRailPreviewModeSubscribers = () => {
  subscribers.forEach((subscriber) => subscriber(mode));
};

export const getRailPreviewMode = (): RailPreviewMode => mode;

export const subscribeRailPreviewMode = (subscriber: RailPreviewModeSubscriber): (() => void) => {
  subscribers.add(subscriber);
  subscriber(mode);
  return () => {
    subscribers.delete(subscriber);
  };
};

export const toggleRailPreviewMode = () => {
  mode = mode === 'user' ? 'userAssistant' : 'user';
  notifyRailPreviewModeSubscribers();
};
