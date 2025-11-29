// Update franchise-specific links with query parameters
export function updateFranchiseLinks(scope = document) {
  console.log('[franchiseLinks] updateFranchiseLinks called');
  console.log('[franchiseLinks] window.franchise_id:', window.franchise_id);

  if (!scope || !window.franchise_id) {
    console.log('[franchiseLinks] Returning early - scope or franchise_id missing');
    return;
  }

  const gmCentralLink = scope.querySelector('#gmCentral');
  console.log('[franchiseLinks] gmCentralLink found:', !!gmCentralLink);

  if (gmCentralLink) {
    const newHref = `/rosters?franchise=${window.franchise_id}`;
    console.log('[franchiseLinks] Updating href to:', newHref);
    gmCentralLink.href = newHref;
  }
}
