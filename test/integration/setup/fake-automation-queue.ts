import {
  AutomationJobData,
  IAutomationQueue,
} from 'src/modules/automation-queue/automation-queue.interface';

/**
 * In-process stand-in for BullmqAutomationQueueService so integration tests never need a real
 * Redis-backed queue/worker. Executes each enqueued job SYNCHRONOUSLY and immediately (via a
 * callback wired up once TasksService is resolvable from the compiled test app - see
 * test-app.ts), rather than actually queueing it - so a test can `await` the request that fires
 * an automation and see its effects immediately, exactly as the pre-queue synchronous
 * implementation behaved. Mirrors FakeRedis/FakeStorageService's role.
 */
export class FakeAutomationQueue implements IAutomationQueue {
  private executor?: (data: AutomationJobData) => Promise<void>;

  setExecutor(executor: (data: AutomationJobData) => Promise<void>): void {
    this.executor = executor;
  }

  async enqueue(data: AutomationJobData): Promise<void> {
    if (!this.executor) {
      throw new Error('FakeAutomationQueue.setExecutor() must be called before enqueue()');
    }
    await this.executor(data);
  }
}
