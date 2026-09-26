import models = require('./models.js');
import drafts = require('./drafts.js');
import sidebar = require('./sidebar.js');
import usage = require('./usage.js');
import skills = require('./skills.js');
import routines = require('./routines.js');
import bounce = require('./bounce.js');
import fleet = require('./fleet.js');
import mobile = require('./mobile.js');
import type { UiScenario } from './contracts.js';

const scenarios = {
  models,
  drafts,
  sidebar,
  usage,
  skills,
  routines,
  bounce,
  fleet,
  mobile,
} satisfies Record<string, UiScenario>;

export = scenarios;
