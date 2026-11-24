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

  /**
   * Preview next customer serial number (starts from 700)
   */
  static async previewNextCustomerCode(session = null) {
    const key = 'CUSTOMER_CODE';
    const counter = await Counter.findOne({ key }).session(session);
    if (!counter) return '700';
    return String(Math.max(700, counter.sequenceValue + 1));
  }

  /**
   * Auto-generate next customer code starting from 700 (Bismillah sequence)
   */
  static async getNextCustomerCode(session = null) {
    const key = 'CUSTOMER_CODE';
    let counter = await Counter.findOne({ key }).session(session);
    if (!counter) {
      try {
        const [created] = await Counter.create([{ key, sequenceValue: 699 }], { session });
        counter = created;
      } catch (err) {
        counter = await Counter.findOne({ key }).session(session);
      }
    }

    const updated = await Counter.findOneAndUpdate(
      { key },
      { $inc: { sequenceValue: 1 } },
      { session, returnDocument: 'after' }
    );

    return String(Math.max(700, updated.sequenceValue));
  }
}
