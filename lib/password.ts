// argon2id — recommended โดย OWASP สำหรับ password hashing
// เลือก argon2id (combining argon2i + argon2d) ทนทั้ง side-channel + GPU attack
import argon2 from "argon2";

// parameters: ตาม OWASP 2024 baseline (memory: 19MB, time: 2, parallelism: 1)
const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // hash format invalid → fail silent (ห้าม leak info)
    return false;
  }
}
