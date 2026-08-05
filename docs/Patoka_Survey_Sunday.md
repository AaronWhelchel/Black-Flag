# Sunday on Patoka — what to bring back

**Short version:** there is no public depth data for Patoka Lake. None. I checked every source that could plausibly have it and queried the two most likely ones live. What you record on Sunday will be the *only* real bathymetry Black Flag has for that lake — and we will own it outright.

## What I checked, and what came back

**USACE eHydro** — the Corps' hydrographic survey portal, public domain, machine-readable. I queried its live ArcGIS endpoint for both districts. Louisville District returns Ohio and Green River navigation pools only; Nashville District returns the Tennessee and Cumberland mainstem pools. eHydro surveys *federal commercial navigation channels*, not flood-control and recreation reservoirs. **Patoka, Rough River and Cumberland are all absent.**

**Indiana DNR lake bathymetry** — IndianaMap hosts a real contour-line service from Biosonics echosounder surveys. I queried it for Patoka: **zero features.** Indiana's own PDF lake-depth-map page doesn't list Patoka either.

**Kentucky (KyFromAbove / KyGeoNet)** — statewide lidar, which is topographic. It does not see through water, and there is no lake bathymetry layer for Rough River or Cumberland.

**USGS** — publishes occasional reservoir surveys (Buckhorn Lake, KY, 2023 is a real example) but coverage is project-driven, not systematic. Nothing for any of our three lakes.

**NOAA NCEI** — coastal, estuarine and Great Lakes. Wrong domain.

**Navionics SonarChart / C-MAP** — these *do* have depth maps for Patoka and Rough River, crowd-sourced from their own users. It is proprietary data belonging to a direct competitor, with no redistribution rights. We do not touch it, we do not scrape it, and we do not look at it while building ours.

**Bottom line:** the lakes are unmapped by anyone who will share. That is exactly why this is the moat. Every sounding you log is data no competitor can legally copy and no government agency is going to publish.

## What to record

The only thing that matters is **synchronised position + depth**: latitude, longitude, and depth below the transducer, logged continuously while you're moving. Not sidescan imagery, not fish arches — just those three numbers, a few times a second.

Every modern unit does this to the SD card, in a format we can read:

- **Lowrance / Simrad** (Elite, HDS, Carbon) → `.sl2` or `.sl3`. Best case. There's a clean open-source reader (`sonarlight`, MIT licence) that turns these straight into lat/lon/depth points.
- **Humminbird** (Helix, Solix, Apex) → `.DAT` + `.SON` files. Readable with PING-Mapper.
- **Garmin** → `.RSD`. Also readable with PING-Mapper.
- **Anything with an NMEA output** → log `$--DBT` (depth) and `$--GGA`/`$--RMC` (position) to a laptop or tablet. Plain text, no proprietary format to fight later.

Turn sonar recording **on at the ramp and leave it running all day.** Don't try to be selective — a boring transit across the middle of the lake is exactly the data nobody has.

## Four numbers to write down before you leave the ramp

These are the difference between usable data and a pile of meaningless depths:

1. **Pool elevation for the day.** Patoka is a flood-control lake; the surface moves 10–30 ft through the year. A reading of "18 ft" means nothing unless we know where the surface was. Check `water.usace.army.mil/overview/lrl/locations/patoka` before you launch and note the number, or just note the time and I'll pull it afterwards.
2. **Transducer depth below the waterline** — how far under the surface the puck sits, in inches. Your sounder reports depth *below itself*, not below the surface.
3. **Your boat's actual draft**, loaded the way it'll be that day.
4. **Whether the GPS antenna is somewhere other than the transducer** (e.g. chartplotter on the console, ducer on the transom). If they're more than a few feet apart, note roughly how far and in which direction.

## Where to run the boat

If you want to be deliberate about it, in priority order:

The **ramp approaches and marina basins** — that's where people actually ground, and it's where a chart earns trust on the first trip. Then the **narrows and the channel edges**, the places the route has to thread. Then **any hazard you've already marked** — run past it slowly at a few different distances so we learn where the shallow actually stops. Then the **coves you like**, and finally, if you're just cruising, **zigzag instead of running straight** — a lazy S across the main body covers three times the ground of a straight line for the same fuel.

## Photos

Geotagged (make sure your phone's camera location is on). Ramps, marina fuel docks, every bridge with something in frame for scale, no-wake signs, buoys and daymarks, hazards you've marked, and anything a stranger arriving at that lake would want to have seen before they got there. Those go into the marks database with the position baked in.

## What I'll do with it

Sonar log in, depth points out, normalised to a fixed datum against the day's pool elevation so your survey and next month's survey stack instead of fighting. Then depth areas built the same way NOAA's are, shipped in the Patoka pack, feeding depth-aware routing against your draft — and every future trip adds to it rather than replacing it.

**Tell me which sounder you have** and I'll have the importer ready before you're off the water.
