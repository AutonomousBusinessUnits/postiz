// Fork (AutonomousBusinessUnits/postiz): AGPL-3.0 section 13 requires offering
// the modified source to every network user. This link is on every page.
export const SourceLink = () => {
  const href =
    process.env.SOURCE_CODE_URL ||
    'https://github.com/AutonomousBusinessUnits/postiz';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="agpl-source-link"
      style={{
        position: 'fixed',
        left: 8,
        bottom: 6,
        zIndex: 2147483647,
        fontSize: 11,
        opacity: 0.6,
        color: 'inherit',
        textDecoration: 'underline',
      }}
    >
      Source code (AGPL-3.0)
    </a>
  );
};
