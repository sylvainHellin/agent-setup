# Adding standards (DIN, ISO, EN)

`zot add` cannot help here.
It takes a DOI or arXiv id, and standards have neither; passing the PDF alone hands it to Zotero's recognizer, which is trained on journal articles and fails on the DIN/ISO title-page layout.
Expect a wrong item or none at all.

The working path is to build the metadata by hand from the title page, create the item through the web API, then attach and index.

## Recipe

```bash
KEY=$(jq -r .api_key ~/Library/Application\ Support/zot/config.json)   # ~/.config/zot/config.json on Linux
cat > /tmp/item.json <<'EOF'
[{
  "itemType": "standard",
  "title": "...",
  "shortTitle": "DIN EN ISO 7519:2025-01",
  "creators": [],
  "organization": "Deutsches Institut für Normung e. V. (DIN)",
  "number": "DIN EN ISO 7519:2025-01",
  "status": "Published, in force",
  "date": "2025-01",
  "citationKey": "isoIso7519Presentation2025",
  "collections": ["COLLKEY"]
}]
EOF
curl -s -X POST "https://api.zotero.org/users/<userID>/items" \
  -H "Zotero-API-Key: $KEY" -H "Content-Type: application/json" \
  -d @/tmp/item.json | jq -r '.successful[] | .key'

zot attach NEWKEY "the.pdf"
zot index
```

Item type is `standard`.
Beyond the usual fields it carries `organization`, `committee`, `number`, `versionNumber`, `status`, `partNumber`, `partTitle`, and `numPages`, which are where the useful identifying detail belongs.

Read the title page rather than the filename: it carries the edition date, the superseded predecessors, the ICS code, and the ISO number the EN version implements.
The DIN document number in the filename is a vendor id, worth keeping in `extra` but not a citable identifier.

## Check the status before trusting it

A standard's identity includes whether it is still in force, and a PDF bought today can be withdrawn.
Two checks pay for themselves:

Search the extracted text for `zurückgezogen` or `withdrawn`.
DIN watermarks every page of a withdrawn document and prints `Nachfolgedokument:` with the successor.
Record both in `status` and `extra`, and keep the item out of any collection that feeds a `.bib` export so a dead standard cannot reach a manuscript.

An old date does not mean superseded.
ISO re-confirms standards through systematic review, so a 1990 document can be current.
Confirm through the ISO catalogue page and note the confirmation date, which is also the answer when a reviewer questions the age of a citation.

Also record what replaced what.
Standards bodies consolidate national norms into EN ISO equivalents, and the supersession chain on the title page is often the clearest evidence of which document a paper should actually cite.

## Sourcing

Nautos (DIN's platform, successor to Perinorm) is often reachable through a university licence (TUM has one) and covers ISO, IEC, EN and national bodies.

It does not carry documents that are not accredited standards.
US industry publications such as the National CAD Standard are sold only by their publisher, so a missing document on Nautos usually means it is not a standard in the formal sense rather than that the search failed.
