import type { PolygonGeometry } from "@/bindings.gen";
import { addPolygonSelections } from "@/lib/map/addPolygonSelections";

/** Prompt for GeoJSON file(s) and add their polygons as selections. */
export async function loadGeoJSON() {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = ".json,.geojson";
	input.multiple = true;
	input.onchange = async () => {
		if (!input.files) return;
		const polygons: PolygonGeometry[] = [];
		for (const file of input.files) {
			try {
				const text = await file.text();
				const data = JSON.parse(text);
				const features = data.type === "FeatureCollection" ? data.features : [data];
				for (const f of features) {
					if (f.geometry?.type === "Polygon") {
						polygons.push({
							coordinates: f.geometry.coordinates,
							extraPolygons: null,
							properties: f.properties ?? undefined,
						});
					} else if (f.geometry?.type === "MultiPolygon") {
						const [first, ...rest] = f.geometry.coordinates;
						if (!first) continue;
						polygons.push({
							coordinates: first,
							extraPolygons: rest.length ? rest : null,
							properties: f.properties ?? undefined,
						});
					}
				}
			} catch {
				/* ignore malformed files */
			}
		}
		void addPolygonSelections(polygons);
	};
	input.click();
}
