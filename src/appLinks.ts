// Universal Links of the iOS app (ios/): links to a race (/zavod/<id>, /zavod/<id>/zive)
// open in the app when it is installed, otherwise on the web as before.

/** Team ID + bundle ID of the app (ios/ZavodyAut.xcodeproj). */
export const IOS_APP_ID = "Z7H5MA4BBC.cz.zavodyaut.app";

export const APP_SITE_ASSOCIATION_PATH = "/.well-known/apple-app-site-association";

/** apple-app-site-association: served as JSON, on every host and without a redirect (Apple doesn't follow one). */
export function appSiteAssociation(): Response {
  const body = {
    applinks: {
      details: [{ appIDs: [IOS_APP_ID], components: [{ "/": "/zavod/*", comment: "Detail závodu a Živě ze závodu" }] }],
    },
  };
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
