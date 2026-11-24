import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { StockBalance } from '../models/StockBalance.js';
import { Warehouse } from '../models/Warehouse.js';

async function clean() {
  await mongoose.connect(process.env.MongoUri);
  const testProds = await Product.find({ sku: /^SKU-TEST-/ });
  const testIds = testProds.map(p => p._id);
  await StockBalance.deleteMany({ productId: { $in: testIds } });
  await Product.deleteMany({ sku: /^SKU-TEST-/ });
  await Warehouse.deleteMany({ code: /^WH-TEST-/ });
  console.log('Cleaned test items. Products remaining:');
  console.log(await Product.find({}, 'name sku'));
  console.log('Warehouses remaining:');
  console.log(await Warehouse.find({}, 'name code'));
  await mongoose.disconnect();
}
clean();
