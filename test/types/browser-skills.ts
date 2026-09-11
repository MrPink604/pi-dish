import type { SkillDirectory, SkillCoverage } from '../../src/browser/skills-data';
import type { createSkills } from '../../src/browser/skills';
declare const directory: SkillDirectory;
declare const coverage: SkillCoverage;
declare const skills: ReturnType<typeof createSkills>;
// @ts-expect-error decoded skill paths remain owned by the read result
directory.skills[0].skill = '/other';
// @ts-expect-error coverage sections cannot be replaced by external consumers
coverage.sections.push({ heading: 'other' });
// @ts-expect-error opening skill detail requires a path
skills.detail({ skill: '/other' });
