const SQLITE_EXPERIMENTAL_WARNING =
  'SQLite is an experimental feature and might change at any time';
const emitWarning = process.emitWarning;

process.emitWarning = function filteredEmitWarning(warning, ...args) {
  const message = warning instanceof Error ? warning.message : String(warning);
  const options = args[0];
  const type =
    warning instanceof Error
      ? warning.name
      : typeof options === 'string'
        ? options
        : options && typeof options === 'object'
          ? options.type
          : undefined;

  if (type === 'ExperimentalWarning' && message === SQLITE_EXPERIMENTAL_WARNING) {
    return;
  }

  return Reflect.apply(emitWarning, this, [warning, ...args]);
};
