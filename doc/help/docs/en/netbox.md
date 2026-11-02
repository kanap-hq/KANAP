# Netbox synchronisation

[Netbox](https://netboxlabs.com/docs/netbox/) describes your physical and virtual infrastructure: devices, virtual machines, racks, sites, addresses. KANAP reads that inventory and keeps its own assets in step with it.

The split of responsibility is deliberate. Netbox stays the reference for the equipment it describes, so the name, the serial number, the rack position or the primary address always come from there. KANAP keeps the business layer around each asset: environment, applications, contracts and costs, support, dates, relations, notes. You stop retyping the inventory, and you keep everything Netbox does not know about.

## Where to find it

- Workspace: **IT Landscape**
- Path: **IT Landscape > Settings**, **Netbox** tab
- Route: `/it/settings?tab=netbox`. The former address `/it/netbox` opens the same tab.
- Connection settings: **Administration > Integrations**
- Permission: `infrastructure:admin`, for both the connection card and the **Netbox** tab. With this permission, the **Settings** entry of the IT Landscape menu appears even if you cannot see the lists of the **Lists** tab.
- Available in the cloud and in the on-premise edition. There is no feature flag to turn on.

---

## Before you start

**A Netbox instance KANAP can reach.** KANAP calls Netbox from the server, not from your browser. The address you enter has to resolve and answer from wherever KANAP runs. In the cloud edition, that address must be a public one: a private or internal address is refused when you save the connection, and again before every call. In the on-premise edition, an address on your own network is exactly what is expected.

**An API token with read access.** In Netbox, open the user menu at the top right, then **API tokens**, and create one. A read-only token is enough: KANAP never writes anything back to Netbox. Give the token a description so you can recognise it later, and rotate it the same way you would any other service credential.

**A decision about the certificate.** If your Netbox uses a certificate KANAP does not trust, typically a self-signed or internal certificate, you can turn on **Ignore certificate errors**. The connection stays encrypted, but the certificate is no longer checked, so use it only for a certificate you know and trust on a network you control. On a public Netbox, install a trusted certificate instead.

---

## Connect KANAP to Netbox

Go to **Administration > Integrations** and open the **Netbox inventory** card.

| Field | What to enter |
|-------|---------------|
| **Enable Netbox synchronisation** | The master switch. When it is off, KANAP never calls Netbox, by hand or on a schedule. |
| **Netbox address** | The address you use to open Netbox in a browser, for example `https://netbox.example.com`. |
| **API token** | The token you created in Netbox. It is stored encrypted and never shown again. Leave the field empty when saving to keep the token already stored. |
| **Request timeout (seconds)** | How long to wait for Netbox before giving up, between 5 and 120. Leave it empty to use 30. |
| **Ignore certificate errors** | Off by default. See above. |
| **Automatic synchronisation** | Runs every hour and applies the changes on its own. Leave it off until your first run looks right. |
| **Environment for new assets** | Applied to the assets this integration creates. It is never changed afterwards. |

**Test connection** makes a read-only call and reports the Netbox version it found, or the reason it failed. Run it after every change to the address or the token. The card shows **Configured** once the connection is saved and switched on. Next to it, the card shows the result and the date of the last test: "Last test succeeded on …" or "Last test failed on …". Once the settings are saved, the card offers a link to **Set up the synchronisation**, which takes you to the **Netbox** tab of **IT Landscape > Settings**.

---

## Choose what is imported

On the **Netbox** tab, open **Mappings**. Four tables sit there. The first two decide the whole scope of the import.

- **Netbox roles > KANAP asset type**. Each device role Netbox knows about gets an asset type, or **Do not import**.
- **Netbox sites > KANAP location**. Each Netbox site gets one of your locations, or **Do not import**.

Anything left on **Do not import** is skipped: its objects are never created, never updated, and never reported as missing. That is how you keep power strips, patch panels or a lab site out of KANAP while still importing the servers next to them.

One extra row sits with the roles: **Virtual machines**. Every virtual machine Netbox holds goes through that single row, whatever role Netbox gives it, so one decision covers the lot. A virtual machine takes its site from its cluster when it does not carry one itself.

Each row shows how many devices and virtual machines it covers, so you can see what a choice is about to bring in. When a Netbox name clearly matches one of yours, the row is pre-filled and marked **Suggested**. A suggestion is only a proposal: nothing is used until you press **Save mappings**. While matches are waiting to be saved, a notice at the top of the tab says how many, with the save button next to it. If you press **Synchronise now** before any role or any site is saved, the preview says so and sends you back to this tab instead of listing every object as skipped.

Mapping a site also brings its Netbox Locations across as sub-locations of the location you chose. Only the top-level Locations of that site, and only the ones an imported device actually sits in. An equipment parked deeper, in "Building A > Floor 1 > Room 101", is attached to "Building A": KANAP records where equipment is at the level of a site and a building, not a room. There is nothing to configure for this.

### Operating systems

The third table matches each Netbox platform with a technology. Netbox says "Debian 12" where KANAP holds the technology Debian with its version "12 (Bookworm)", and this is where the two are tied together. Every row shows how many objects run that platform.

The list offers your technologies of the **Operating system** family, alone and with each of their versions, then the operating systems of the technology catalog you have not added yet. The value kept is the technology name, with its version when you pick one. At the next run, KANAP records that technology and version as the server's operating system, and adds a catalog entry to your technologies when you picked one.

Rows are pre-filled when KANAP can see the answer: the same name, or the single choice whose name starts with the platform name. "Debian 12" suggests "Debian 12 (Bookworm)". As with the other tables, a suggestion counts only once you press **Save mappings**.

This table is not a filter. A platform left on **No match** never keeps anything out of the import. The equipment comes in and its operating system is left exactly as it is in KANAP. Match the platform later and the next run fills the field.

Netbox grants read access per object type, so a token allowed to read devices, roles and sites can still be refused the platforms. The roles and the sites keep working and the import is unaffected. Only this section is empty, and it says why.

### Clusters { #clusters }

The **Clusters** section matches each Netbox cluster with a KANAP cluster: an asset marked as a cluster, in service. Each row shows how many virtual machines the Netbox cluster holds. A KANAP cluster with the same name is suggested, and as elsewhere a suggestion counts only once you press **Save mappings**.

At the next run, each virtual machine of a matched cluster is added to the **Contains** relations of its KANAP cluster. A technology installed on the cluster then reaches the machine and the applications hosted on it. A machine whose only change is its cluster shows under **To update**, with a **Cluster** line. A machine the run creates joins its cluster at once.

When a member host of the matched cluster contains the machine today, attaching it to the cluster replaces the host's link. The preview shows it on the machine's row, with a **Placement** line from the host to the cluster. See [Virtual machines on a cluster](assets.md#virtual-machines-on-a-cluster).

Apart from that, the import only adds:

- A machine already in another KANAP cluster stays there. The preview says so on the machine's row, so you can remove that relation by hand if it is out of date.
- Changing a match adds the machines to the new cluster and keeps them in the old one.
- A machine you take out of its cluster comes back at the next run, as long as it sits in that Netbox cluster and the match exists. To take it out for good, remove the match first, then the relation.

A Netbox cluster left on **No match** attaches nothing and does not block the import. The preview mentions it once. A match on an asset that was deleted, retired or is no longer a cluster attaches nothing either, and every run reports it as a warning. It does not stop you from saving the other matches.

The hosts are not attached: cluster members stay yours to manage from the cluster's page. If the API token cannot read clusters, the section says so and the rest of the tab keeps working.

---

## The first synchronisation

Press **Synchronise now**. KANAP reads Netbox and shows **Review before applying** before writing anything.

The preview is grouped:

- **Sub-locations**: the shared rows the run creates, adopts or renames, listed once each with the location they belong to and how many equipment end up in them. Renaming a Location in Netbox shows up here as one line, not as every asset moving.
- **To create**: objects with no counterpart in KANAP. They will be created.
- **To update**: objects matched to an existing asset that differs. Nothing is changed yet, the values are written when you apply. Each one lists the fields that change, field by field, as `before → after`.
- **Needs a decision**: objects KANAP will not decide on its own. Nothing happens to them until you settle them, here or later on the page.
- **Skipped**: objects out of scope, counted by reason (role not mapped, site not mapped, no name in Netbox, ignored by you). The first 20 objects of each reason are named, then the count of the others.
- **Missing from Netbox**: assets a previous run linked whose Netbox object is gone.
- **Warnings**: values Netbox reports that KANAP could not take over, for example an operating system KANAP cannot find among its technologies. An object with nothing to change but something to report appears here too.

Read it, then press **Apply**. Objects that are already identical are counted as unchanged and not touched at all. A large inventory is reviewed in batches of 500. **Apply this batch** writes only what the preview lists; everything else is left exactly as it is. The page then says how many objects still wait and offers **Review the next batch**, until nothing is left. Nothing you have not been shown is ever created or updated by a run you start yourself. Objects out of scope sit apart, under **Skipped**, so they never take the place of an object you need to read. The filter at the top narrows the list to an object or an asset name.

### Correct the preview before applying

KANAP can only recognise an asset through its serial number, its host name or its name. Equipment you renamed, with none of these in common, shows up under **To create** and would be created a second time. The preview lets you settle that first. A row KANAP proposes something for has a button, **Link instead** under **To create** and **To update**, **Decide** on objects that need a decision. An object already linked by an earlier run has none: it is settled, and the row only shows what changes. A first match says what it rests on ("Recognised by its serial number"), so you can tell a wrong one. The button opens these choices:

- **Link to an existing asset**: search for the asset and pick it. The row moves to **To update** and shows what Netbox will change on that asset, field by field, so you still read before you apply.
- **Create a new asset**: for an object under **Needs a decision**, or one KANAP matched to the wrong asset.
- **Do not import this object**: the object is left out of this synchronisation and the next ones. Nothing happens to any asset. It moves to **Settled by you** in the preview and, once applied, to **Ignored** on the page, where you can take it back later.

A row you decided on says so and offers **Undo**. When several objects under **Needs a decision** have a single suggested asset, **Link the N objects that have a single suggestion** settles them all at once. They move to **To update**, where you read what changes before applying.

Nothing is written while you decide. Your choices are applied with everything else when you press **Apply**, and they hold afterwards: the automatic synchronisation follows the links you made. Closing the preview discards them.

Applying runs in the background. The page follows it and refreshes on its own when it finishes.

---

## How objects are matched to existing assets

A first import into a populated KANAP has to find the assets you already have instead of duplicating them. KANAP tries four things, in order, and stops at the first one that finds anything:

1. **An existing link**. The object was already matched to an asset on a previous run.
2. **The serial number**. This survives a rename on either side.
3. **The host name**, taken whole. `par-esx-01.example.com` in Netbox is the asset whose host name is written that way. It is also the asset `par-esx-01` when `example.com` is one of your domains, because you declared that suffix yourself.
4. **The asset name**, ignoring case, read the same way.

If a step finds exactly one asset, that is the match. If it finds several, KANAP stops there and files the object under **To decide** with the candidates listed. It never merges on a guess.

**Two signals are proposals, never matches.** When none of the four steps identifies the object, KANAP looks for a resemblance rather than creating straight away.

- **A name that starts the same.** An asset whose name or host name matches only the first part of the Netbox name, up to the first dot, is offered as a candidate. In an inventory that names equipment `dl3.robot-15ms.ie2000`, that first part is a building and not a machine, and one asset named `dl3` would quietly absorb the whole floor.
- **An address already held.** An asset that already carries the object's primary address is offered the same way. Addresses are reused, shared between cluster members, or simply out of date.

In both cases the object is not created. It goes to **To decide** with that asset as the suggestion, under "An asset has a similar name. Choose whether it is the same equipment." or "An asset already uses the address ...", and one click settles it. Neither signal ever links on its own, even when a single asset is found: a wrong link would let Netbox overwrite the wrong asset. The automatic synchronisation follows the same rule and writes nothing for such an object, so a new Netbox device never becomes a duplicate behind your back.

Two further rules keep the result clean:

- **One asset belongs to one Netbox object**, and the other way round. The database enforces it. An asset another object already owns is out of reach for everything else, and linking an asset that is already taken is refused with a message naming the object holding it. If two Netbox objects reach the same free asset, both are sent to you for a decision.
- **A device deleted and recreated in Netbox is picked up again.** It comes back with a new Netbox identifier, so the old record becomes missing, releases its asset, and the new object takes it over by host name in the same run. If another object took that asset over in the meantime, the returning device is judged like a new object.

---

## Which fields Netbox manages

| Managed by Netbox | Stays yours in KANAP |
|-------------------|----------------------|
| Name | Environment |
| Host name and domain | Notes and description |
| Serial number | Dates, support and warranty |
| Manufacturer and model | Contracts and costs |
| Rack and rack unit | Applications hosted on the asset |
| Primary IP address | Connections and other relations |
| Operating system | Attachments, tasks, incidents |
| Lifecycle status | Everything else on the asset |
| Location | |
| Sub-location | |

On an asset that is linked to Netbox, a managed field is shown as **Managed by Netbox** and cannot be edited in KANAP. Change it in Netbox and the next run brings it over. Everything else on the asset stays editable as usual.

**Only the fields Netbox actually fills for that object are locked.** Netbox has no notion of a domain, a device often has no platform, and it sometimes has no primary address. Those fields stay yours to complete, and since a synchronisation never writes an empty value, what you type there is never overwritten. The asset page says it in one line: "Netbox fills in the fields it provides. The others are yours to complete."

Every run refreshes that list, including on an object where nothing changed. Add a platform in Netbox and the operating system is taken over at the next run, and locked from then on. An asset imported before this behaviour existed keeps all its fields locked until its next synchronisation.

The asset page also carries a **Source** line: when the last synchronisation happened, a link to **Open in Netbox**, and a warning when the object is no longer there.

### Rules worth knowing

**An empty Netbox value never erases a KANAP value.** If Netbox has no serial number and KANAP has one, the serial number is kept. Only a value Netbox actually holds is written.

**Manual edits are corrected.** Each run compares against the real values on the asset, so a managed field changed in KANAP some other way is put back in line at the next run.

**A dot is only a domain when you say so.** A Netbox name is split into a host name and a domain when it ends with a DNS suffix from your domain list in **IT Landscape > Settings**. The longest suffix wins, so a name ending in `corp.example.com` takes that domain rather than `example.com`. Anything else is simply a name: `dl3.robot-15ms.ie2000` becomes the host name as it stands, dots included, and the domain is left alone. Nothing is reported, because nothing is wrong. To have a suffix recognised, add the domain in the settings and the next run splits the name on its own.

Assets imported before this rule, whose host name was cut at the first dot, are put back in line by the next run. The correction shows up in the preview as an ordinary host name change.

**Renaming is understood.** A difference in case is not a rename. Neither is a domain suffix you declared: `PAR-ESX-01` and `par-esx-01.example.com` are the same machine as `par-esx-01` when `example.com` is one of your domains.

**Lifecycle follows a fixed table.**

| Netbox status | KANAP lifecycle |
|---------------|-----------------|
| Planned, Staged, Inventory | Proposed |
| Active, Offline, Failed, Paused | Active |
| Decommissioning | Deprecated |
| Anything else | Left unchanged, with a warning |

**Offline, Failed and Paused stay visible.** The lifecycle remains Active, because the equipment is still in service on paper. KANAP keeps the Netbox status and shows it as a notice: on the asset, next to its source ("Netbox status: Failed"), in the **Linked** list, and under **Warnings** in the preview. Changing only this status in Netbox never rewrites the asset.

A synchronisation never sets an asset to **Retired**. Retiring equipment is a decision you take, from the **Missing from Netbox** list.

**Environment is set once.** New assets get the environment chosen on the integration card. Later runs never touch it, so you can correct it in KANAP and it stays corrected.

**Values KANAP does not know are skipped, never invented.** A lifecycle status with no equivalent, or an operating system with no match in **Mappings** and no technology of that name in the **Operating system** family or the catalog, is left unchanged and reported as a warning. Match the platform, or add the technology, then run again. An IPv6 primary address is left out the same way, with the notice "The primary address is an IPv6 address, which is not imported yet."

**Sub-locations are shared between equipment.** A sub-location is one row at a location, and every asset placed there points at it. Renaming the Location in Netbox renames that one row, so all the equipment carrying it follows at once, including equipment you filed there yourself. Nothing moves asset by asset.

**A sub-location you created by hand is adopted, not duplicated.** When a Netbox Location has the same name as a sub-location you already use at that location, KANAP links the two: your row keeps its identity, takes the Netbox spelling, and is marked **Netbox** from then on. Your assets stay where they are.

**Nothing is ever deleted.** A Location removed from Netbox leaves its sub-location in place, with the assets that carry it. A sub-location linked to Netbox stays editable: rename it or delete it in KANAP and the next run puts it back in line, creating it again if an asset still needs it.

**A device with no Location keeps its sub-location.** Only a Location Netbox actually reports is written, the same rule as every other managed field. Virtual machines never receive one: a Netbox virtual machine carries no Location.

**Two Locations with the same name at one site.** Netbox allows "Local technique" and "local technique" side by side, KANAP does not. The first one imported wins, and the other is reported as a warning. The same happens when two Netbox sites are mapped to the same KANAP location and both hold a Location of the same name.

**If Netbox does not return its Locations**, the run carries on with the equipment and leaves every sub-location untouched, with a note in the preview saying so. A partial assignment would be worse than none.

**A new asset takes the provider of its location** when that provider exists in your IT settings, and "Other" otherwise. Netbox has no notion of a hosting provider.

**A run that keeps failing stops.** After 10 objects in a row fail to save, the run stops and is reported as failed, instead of filling the list with error rows and then claiming success.

**A partial read never marks anything missing.** If Netbox holds more pages than KANAP reads in one run, nothing is reported as missing and a notice sits next to the result.

**A server restart does not block the page.** **Synchronise now** works again straight away; a run cut short by the restart is reported as stopped without finishing.

---

## Automatic synchronisation

Turn **Automatic synchronisation** on in the integration card and KANAP runs the same job every hour, applying the changes without a preview. The switch is per tenant, and only tenants that turned it on are visited. The hourly job never does the first import: it starts once you have applied a synchronisation yourself and it finished without error. Until then the switch can be on and nothing runs. The same holds while a review is unfinished: as long as objects wait for their batch, the hourly job stays on hold, because it would import what nobody has read. It resumes once a synchronisation you apply leaves nothing waiting.

Objects that need a decision are never resolved automatically. They pile up under **To decide** and wait for you.

Sub-locations are created and renamed by the automatic run too. A tenant whose first import is already done receives them at the next hourly run, without a preview beforehand.

A manual run and a scheduled run cannot overlap: if one is already going, the other does nothing for that tenant and tries again later. In the cloud edition, a tenant whose subscription is frozen or whose trial has expired is skipped until the subscription is sorted out. On-premise installs are not concerned.

---

## The Netbox tab

The **Netbox** tab of **IT Landscape > Settings** is where the work happens after the connection is set up. The strip at the top shows the last run: when it happened, whether it was started by hand or automatically, how long it took, its result, and how many objects are linked or need attention.

Below it, the **Objects** tab lists every Netbox object in scope, filtered by state.

The **Type** column reads the KANAP asset type of the linked asset, "Physical server" or "Virtual machine" rather than the word "Device" for everything. An object with no asset yet shows its Netbox type in grey, because that is all there is to say about it so far. Next to the state filters, a search field narrows the list. It matches the Netbox name, the asset name and the asset reference, and the list follows the field a moment after you stop typing.

| State | What it means | What you can do |
|-------|---------------|-----------------|
| **To decide** | Several assets could be this object, two objects reached the same asset, an asset has a similar name, or an asset already holds the object's IP address. | **Link to...** one of the candidates, **Create new asset**, or **Ignore**. |
| **Missing from Netbox** | The object is gone from Netbox. The asset is untouched. | **Mark asset as retired**, **Ignore**, or leave it. |
| **Errors** | The object could not be written, with the reason in the message column. | Fix the cause and run again, or **Ignore** the object. |
| **Ignored** | You told KANAP to leave this object alone. It is skipped by every run. | **Stop ignoring** puts it back in the list. When the record holds nothing to decide, it is removed instead and the object is judged afresh at the next synchronisation. |
| **Linked** | The object and the asset are matched and up to date. | Open either side from the row. |

Each row links to the object in Netbox and to the asset in KANAP, with its `AST-` reference.

Linking or creating from this page applies the Netbox values straight away. It reads that one object from Netbox, so it stays quick on a large inventory. Messages and warnings are shown in your own language.

### Missing from Netbox

**KANAP never deletes an asset.** When an object disappears from Netbox, the asset, its links and its history stay exactly as they are, and the object is listed as missing so that you can decide. **Mark asset as retired** sets the lifecycle to Retired and keeps everything else.

Two safeguards apply. Nothing is reported as missing when the call to Netbox failed, or when Netbox returned an empty inventory: an outage is not a decommissioning. And an asset whose Netbox object disappeared is free again, so the same machine recreated in Netbox links back to it instead of creating a duplicate.

---

## The home dashboard tile

A **Netbox synchronisation** tile is available on your personal dashboard. It is off by default. To turn it on, click **Customize the home page**, then **Add a tile** in the **IT landscape** section, and choose **Netbox synchronisation**. See [Customizing your dashboard](my-dashboard.md#customizing-the-budget-section). The tile needs `infrastructure:admin`, like the rest of the integration.

The tile stays out of the way when there is nothing to do: one line saying the synchronisation is up to date, with the time of the last run. When something needs attention, it lists only what does, objects to decide, assets missing from Netbox, errors, or a failed run, and each line opens the matching filtered list.

---

## Troubleshooting

| What you see | What it usually means |
|--------------|-----------------------|
| Netbox rejected the API token | The token was truncated when pasted, has expired, or is restricted to another address. Create a fresh one in Netbox and save it again. |
| This address points at a private network | The cloud edition only reaches public addresses. Either publish Netbox at an address KANAP can reach, or run KANAP on-premise next to it. |
| The Netbox certificate could not be verified | Netbox presents a certificate KANAP does not trust. Install a trusted certificate, or turn on **Ignore certificate errors** if the certificate is one of yours. |
| The Netbox server did not answer in time | Netbox is slow, unreachable, or behind a firewall that drops the call. Check from the KANAP server, then raise the request timeout if the instance is simply large. |
| Objects show as skipped, reason "Role not mapped" or "Site not mapped" | Expected for anything you left on **Do not import**. If it was not meant to be skipped, map the role or the site and run again. |
| A warning says an operating system is not in your catalogue | The Netbox platform has no match in **Mappings > Operating systems**, and its name matches no technology of the **Operating system** family and no operating system of the catalog. Match it in the Mappings tab, or add the technology in **IT Landscape > Technologies**, then run again. The operating system is left unchanged until you do. |
| "Netbox did not return its platforms" | The API token cannot read platforms. Give it permission on `dcim.platform` in Netbox, or leave it: the equipment still imports, and only the operating system matching is out of reach. |
| An asset ends up with the whole Netbox name as its host name | The name does not end with a DNS suffix from your domain list, so KANAP keeps it as it is. That is the expected result for a name whose dots are part of the name. If it really is a domain, add it in **IT Landscape > Settings** and run again. |
| The run failed after a handful of objects | Ten objects in a row could not be saved, so the run stopped. The cause is usually the same for all of them, and the details are in the server log. |
| "Netbox returned more pages than expected. Some objects were not looked at." | The inventory is larger than one run reads. What was read is applied, and nothing is marked missing. Narrow the scope in **Mappings** so the run covers what matters to you. |
| A sub-location warns that its name is already used | Two Netbox Locations of that site share the name, or two mapped sites point at the same KANAP location and each holds a Location of that name. Rename one of them in Netbox, or merge them there. The equipment is imported either way, without a sub-location. |
| "Netbox did not return its clusters" | The API token cannot read clusters. Give it permission on `virtualization.cluster` in Netbox, or leave it: the equipment still imports, and only the attachment of virtual machines to their cluster is out of reach. |
| A virtual machine was not attached to its cluster | Its Netbox cluster has no match in **Mappings > Clusters**, or the match points to an asset that is retired or no longer a cluster. Fix the match, then run again. |
| "Netbox did not return its locations" | The API token cannot read Locations. Give it permission on `dcim.location` in Netbox, or leave it: the equipment import is unaffected. |

---

## Tips

- **Map first, synchronise second.** The mapping is the scope. Start with the roles and sites you are sure about, run once, and widen it afterwards.
- **Declare your DNS suffixes first.** A Netbox name is only split into a host name and a domain when it ends with a suffix you hold in **IT Landscape > Settings**. Add the domains you use before the first run, and the names arrive already split.
- **Read the preview on the first run.** It is the only run where every match is new, so it is the one worth reading line by line.
- **Renamed equipment: check the To create list.** Anything you recognise there is about to be duplicated. Link it to its asset in the preview, or fill in its serial number or host name in KANAP and open the preview again.
- **Fill in the serial numbers.** It is the sturdiest match there is. Assets that carry a serial number survive renames on both sides without ever landing in **To decide**.
- **Wait before turning the hourly run on.** Two clean manual runs in a row, the second one showing nothing to change, means the mapping and the matches are right.
