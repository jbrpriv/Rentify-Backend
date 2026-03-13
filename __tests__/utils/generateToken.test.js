const jwt = require('jsonwebtoken');
const { generateAccessToken, generateRefreshToken } = require('../../utils/generateToken');

describe('generateAccessToken', () => {
  it('returns a three-part JWT string', () => {
    const token = generateAccessToken('user1');
    expect(token.split('.')).toHaveLength(3);
  });

  it('encodes the user id in the payload', () => {
    const token   = generateAccessToken('user1');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.id).toBe('user1');
  });

  it('expires in 15 minutes', () => {
    const token   = generateAccessToken('user1');
    const decoded = jwt.decode(token);
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });

  it('produces a different token each call (iat advances)', () => {
    jest.useFakeTimers();
    const t1 = generateAccessToken('user1');
    jest.advanceTimersByTime(1000);
    const t2 = generateAccessToken('user1');
    expect(t1).not.toBe(t2);
    jest.useRealTimers();
  });
});

describe('generateRefreshToken', () => {
  it('returns a three-part JWT string', () => {
    expect(generateRefreshToken('user1').split('.')).toHaveLength(3);
  });

  it('encodes the user id in the payload', () => {
    const token   = generateRefreshToken('user1');
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    expect(decoded.id).toBe('user1');
  });

  it('expires in 30 days', () => {
    const token   = generateRefreshToken('user1');
    const decoded = jwt.decode(token);
    expect(decoded.exp - decoded.iat).toBe(30 * 24 * 60 * 60);
  });

  it('is signed with JWT_REFRESH_SECRET, not JWT_SECRET', () => {
    const token = generateRefreshToken('user1');
    expect(() => jwt.verify(token, process.env.JWT_SECRET)).toThrow();
    expect(() => jwt.verify(token, process.env.JWT_REFRESH_SECRET)).not.toThrow();
  });
});
