import { Counter } from '../models/Counter.js';

export class CounterService {
  /**
   * Generates next gapless sequence number in format: <PREFIX>-<YYYY>-<MM>-<NNNN>
   * Uses Asia/Karachi date to determine year and month
   * Must be called inside a MongoDB session transaction for gapless integrity
   * @param {string} prefix - e.g. 'INV', 'DO', 'DC', 'PAY', 'CN', 'RET'
   * @param {import('mongoose').ClientSession} session
   * @returns {Promise<string>}
   */
  static async getNextNumber(prefix, session = null) {
    // Current date in Asia/Karachi (UTC+5)
    const now = new Date();
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const karachiOffset = 5 * 60 * 60000;
    const karachiDate = new Date(utcTime + karachiOffset);

    const year = karachiDate.getFullYear();
    const month = String(karachiDate.getMonth() + 1).padStart(2, '0');
    const key = `${prefix}-${year}-${month}`;

    const counter = await Counter.findOneAndUpdate(
      { key },
      { $inc: { sequenceValue: 1 } },
      { session, upsert: true, returnDocument: 'after' }
    );

    const seqFormatted = String(counter.sequenceValue).padStart(4, '0');
    return `${key}-${seqFormatted}`;
  }
}
