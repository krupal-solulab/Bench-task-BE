import {
  ITicketAutomationQueue,
  TicketAutomationJobData,
} from 'src/modules/ticket-automation-queue/ticket-automation-queue.interface';

/**
 * In-process stand-in for BullmqTicketAutomationQueueService so integration tests never need a
 * real Redis-backed queue/worker - mirrors FakeAutomationQueue exactly, kept as a separate class
 * (not reused) since it stands in for a genuinely separate queue.
 */
export class FakeTicketAutomationQueue implements ITicketAutomationQueue {
  private executor?: (data: TicketAutomationJobData) => Promise<void>;

  setExecutor(executor: (data: TicketAutomationJobData) => Promise<void>): void {
    this.executor = executor;
  }

  async enqueue(data: TicketAutomationJobData): Promise<void> {
    if (!this.executor) {
      throw new Error('FakeTicketAutomationQueue.setExecutor() must be called before enqueue()');
    }
    await this.executor(data);
  }
}
