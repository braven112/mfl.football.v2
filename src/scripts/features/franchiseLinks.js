// Update franchise-specific links with query parameters
export function updateFranchiseLinks(scope = document) {
  if (!scope || !window.franchise_id) return;

  const gmCentralLink = scope.querySelector('#gmCentral');
  if (gmCentralLink) {
    gmCentralLink.href = `/rosters?franchise=${window.franchise_id}`;
  }
}
