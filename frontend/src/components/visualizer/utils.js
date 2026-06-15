function getDeployedReleases(releases) {
  if (!Array.isArray(releases)) return [];
  return releases.filter((release) => release?.status === 'deployed');
}

export { getDeployedReleases };
