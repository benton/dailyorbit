# Sources of Truth for Company Detection

## The Legal Entity Identifier

The Legal Entity Identifier (LEI) enables clear and unique identification of legal entities engaging in financial transactions and other official interactions. Implementation of the LEI increases the ability of authorities in any jurisdiction to evaluate risk, conduct market surveillance and take corrective steps. Use of an LEI and vLEI also generates tangible benefits for businesses including reduced counterparty risk and increased operational efficiencies. [This page](https://www.gleif.org/en/lei-data/access-and-use-lei-data) describes how to access the quality assured LEI data pool to easily and quickly source information on who is who and who owns whom free of charge.It also provides an overview of the daily LEI data reporting performed by the LEI issuing organizations together with information regarding Common Data File formats utilized in this process to ensure high quality LEI reference data, as defined by ISO 17442. 

## GLEIF

The [Global Legal Entity Identifier Foundation (GLEIF)](https://www.gleif.org) is the
operational arm of the LEI system. They maintain the Golden Copy — the authoritative,
deduplicated global registry of all LEI records — and publish it freely 3x daily in
CSV, JSON, and XML formats.

See [gleif/](gleif/) for detailed technical documentation on the data and APIs.

### ISO Standards

These define the LEI system. They are paid standards (~CHF 60-120 each) but the
practical specs are published freely by GLEIF as CDF (Common Data File) schemas.

  - ISO 17442-1:2020 - Financial services - Legal entity identifier (LEI) - Part 1: Assignment
  - ISO 17442-2:2020 - Financial services - Legal entity identifier (LEI) - Part 2: Application in digital certificates
  - ISO 17442-3:2024 - Financial services - Legal entity identifier (LEI) - Part 3: Verifiable LEIs (vLEIs)
