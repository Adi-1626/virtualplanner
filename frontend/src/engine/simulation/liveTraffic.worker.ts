import { attachLiveWorker, type LiveWorkerScope } from './liveTrafficWorkerMain';

/** The live view's worker (liveTrafficWorkerMain.ts): the worker's own scope receives the commands. */
attachLiveWorker(self as unknown as LiveWorkerScope);
