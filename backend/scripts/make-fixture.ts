/**
 * Generates the AutoCut test videos (the same ones the Jest tests use) and prints their paths.
 * Usage: npx tsx scripts/make-fixture.ts [outDir]
 */
import path from 'node:path';
import { FIXTURE_DIR, fixturePath, type FixtureName } from '../src/autocut/testing/fixtures';

const NAMES: FixtureName[] = ['main.mp4', 'silent.mp4', 'portrait.mp4', 'narrow.mp4', 'too-long.mp4'];

async function main(): Promise<void> {
  const dir = path.resolve(process.argv[2] ?? FIXTURE_DIR);
  for (const name of NAMES) console.log(await fixturePath(name, dir));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
