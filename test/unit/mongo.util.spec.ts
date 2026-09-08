import { Types } from 'mongoose';
import { extractId } from 'src/common/utils/mongo.util';

describe('mongo.util extractId', () => {
  it('extracts the string id from a raw ObjectId', () => {
    const id = new Types.ObjectId();
    expect(extractId(id)).toBe(id.toString());
  });

  it('extracts the string id from a populated document shape ({ id })', () => {
    const populated = { id: '507f1f77bcf86cd799439011', name: 'Someone' };
    expect(extractId(populated)).toBe('507f1f77bcf86cd799439011');
  });

  it('stringifies a plain string unchanged', () => {
    expect(extractId('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
  });

  it('prefers the populated id over toString() when both are present', () => {
    const populated = {
      id: 'the-real-id',
      toString: () => 'wrong-if-this-is-used',
    };
    expect(extractId(populated)).toBe('the-real-id');
  });
});
