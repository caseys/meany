import { describe, expect, it } from 'vitest';
import { allowedAt, cleanUp, toTone, type ToneLevel } from '../src/runtimes/tone.ts';
import { nextRoast } from '../src/runtimes/roasts.ts';
import { nameQuestion, nextNag, nextQuestion } from '../src/runtimes/questions.ts';

const ROUGH = 'What the fuck, you fucking dumbass. This shit is bullshit, you bitch. Kiss my ass, asshole.';
const MILD = 'Damn, that is a hell of a crappy idea.';

describe('cleanUp', () => {
  it('Friendly and Cheeky leave no bad words at all', () => {
    for (const level of [0, 1] as ToneLevel[]) {
      const clean = cleanUp(`${ROUGH} ${MILD}`, level);
      expect(allowedAt(level, clean), clean).toBe(true);
    }
  });

  it('Sassy keeps mild words and drops the rest', () => {
    const clean = cleanUp(`${ROUGH} ${MILD}`, 2);
    expect(allowedAt(2, clean), clean).toBe(true);
    expect(clean).toMatch(/Damn/);
  });

  it('Spicy drops only the f-word', () => {
    const clean = cleanUp(ROUGH, 3);
    expect(clean).not.toMatch(/fuck/i);
    expect(clean).toMatch(/shit/);
  });

  it('Savage changes nothing', () => {
    expect(cleanUp(ROUGH, 4)).toBe(ROUGH);
  });

  it('keeps the case of the word it replaces', () => {
    expect(cleanUp('Fucking hell. SHIT.', 0)).toBe('Freaking heck. JUNK.');
  });

  it('leaves innocent words alone', () => {
    const text = 'Hello class, I assume the cocktail shell from Dickens is classic and passes the assessment.';
    expect(cleanUp(text, 0)).toBe(text);
    expect(allowedAt(0, text)).toBe(true);
  });
});

describe('the canned lines at each level', () => {
  for (const level of [0, 1, 2, 3, 4] as ToneLevel[]) {
    it(`level ${level} only says lines within its limit`, () => {
      for (let i = 0; i < 300; i++) {
        for (const line of [nextRoast(level), nextQuestion(level).text, nameQuestion(level).text, nextNag(level)]) {
          expect(allowedAt(level, line), `level ${level}: ${line}`).toBe(true);
          expect(line.length).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe('toTone', () => {
  it('keeps the level within 0 to 4', () => {
    expect(toTone('2')).toBe(2);
    expect(toTone(9)).toBe(4);
    expect(toTone(-3)).toBe(0);
    expect(toTone('nonsense')).toBe(0);
  });
});