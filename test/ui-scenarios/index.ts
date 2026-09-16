// Only the registry is checked in this runner/support family. Scenario bodies
// remain authored JavaScript until their product contracts are released; the
// runner enumerates names and makes no callable claim about these values.
const scenarios: Record<string, unknown> = {
  models: require('./models'),
  drafts: require('./drafts'),
  sidebar: require('./sidebar'),
  usage: require('./usage'),
  skills: require('./skills'),
  routines: require('./routines'),
  bounce: require('./bounce'),
  mobile: require('./mobile'),
};
export = scenarios;
