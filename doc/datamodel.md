# Data Model

## 1. Application

Represents an Application to the IBFS.

The following applications are available on IBFS for electronic filing:

- Space and Earth Station Applications:
  - Earth Station Authorizations – Form 312
  - Earth Station Special Temporary Authority
  - Space Station Authorizations – Form 312
  - Space Station Special Temporary Authority
  - Modifications of Authorization – Form 312
  - Amendments to Pending Applications – Form 312
  - Transfers of Control of License – Form 312
  - Assignments of License – Form 312
- International Accounting Rate Change Filings
- Submarine Cable Landing License Applications
- Requests for Assignment of Data Network Identification Codes
- Foreign Carrier Affiliation Notification Filings
- International Section 214 Applications
- International Section 214 Special Temporary Authority
- International Signaling Point Code Filings
- Recognized Operating Agency Filings
- Renewal of Radio License in Specific Services

Fields:

- File Number
- Report Number

### 1.1. Application File Number

The FCC assigns file numbers to electronic applications in order to facilitate processing.
The FCC only assigns file numbers for administrative convenience; they do not mean that an application is acceptable for filing.

IBFS uses a standard file number format for all processes handled in the International Bureau. The standard file number format is composed of four, hyphenated parts:

- Subsystem
- Application Type
- Date Filed (Year,Month,Day)
- Sequential File Number

Example: `SAT-LOA-20040701-00011`

#### 1.1.1. Subsystem

The IBFS system consists of 13 subsystems, each representing a specific service category. They are:

325 Section 325-C applications for permit to foreign broadcast (Part 73)
ARC Accounting Rate Changes filings (Part 63)
DNC Requests for assignment of a data network identification code (Part 64)
FCN IHF IPF ISP ITC SAT SCL SES Foreign Carrier Notification Filings (Part 64)
International HF Broadcast Applications (Part 73)
International Public Fixed Radio applications (Part 23)
International Special Projects filings (Part 63)
International Telecommunications Certificate (Part 63)
ROA Requests for Recognized Operating Agency status (Part 63)
Applications for satellite space station authorizations (Part 25)
Applications for Submarine Cable Landing licenses (Part 63)
Applications for Satellite Earth Station licenses or registration
(Part 25)
SPC Requests for assignment of an international Signalling Point Code
(Part 64)

#### 1.1.2. Application Type

3.  Application types are defined as follows:

214 Section 214 Authority
AMD Amendment to a pending application
A/O Authority to operate a satellite space station
ASG Assignment of License
C/P Construction Permit
DRZ Declaratory Ruling for Zoning
EXT Request for Extension of time to construct
ISP International Special Project (determined by the FCC)
ITC International Telecommunications
L/A Authority to launch a satellite space station
2
LFS Authority to access a non-U.S. satellite not currently authorized to
provide the proposed service in the proposed frequencies in the
United States
LIC License to operate
LOA Authority to launch and operate a satellite space station
LOI Letter of Intent to participate in a satellite space station processing
round
LPN Landing Points Notification
MSC Miscellaneous filing (determined by FCC)
MOD Modification to a current license, authorization or accounting rate
NDS Request for non-dominant status
NEW New application -- use only for the 325, DNC, FCN and ROA
subsystems
NOT Notification
PDR Petition for Declaratory Ruling
PPL Petition for Declaratory Ruling to be added to the Permitted List
REG Registration of a receive-only earth station
RPL Replacement Satellite Application - no new frequency bands
RWL Renewal of license or authorization
STA Request for Special Temporary Authority
TOA Request for Special Temporary Authority for the ISP, ITC and SCL
subsystems
T/C Transfer of Control
WAV Request for Waiver -- used only for the ISP, ITC, SAT and SCL
subsystems
WVZ Request for Waiver of the FCC zoning regulations; used only in SAT
subsystem.

#### 1.1.3 Official Date Filed

#### 1.1.4. Sequential File Number

A sequential number is assigned by the IBFS system to a filing within a subsystem. This number is an internal tracking number for use by the Bureau.

### 1.2. Application Report Number

Each ‘Accepted for Filing’ Public Notice has a report number. Below are examples of various types of applications and their corresponding report number (the ‘x’ represents a sequential number).

Type of Application: Report Number

325-C Applications: 325-xxxxx
Accounting Rate Change: ARC-xxxxx
Foreign Carrier Affiliation Notification: FCN-xxxxx
International High Frequency: IHF-xxxxx
International Public Fixed: IPF-xxxxx
Recognized Operating Agency: ROA-xxxxx
Satellite Space Station: SAT-xxxxx
Satellite Earth Station: SES-xxxxx
International Telecommunications
Streamlined: TEL-xxxxxS
Non-streamlined: TEL-xxxxxNS and/or DA
Submarine Cable Landing
Streamlined: SCL-xxxxxS
Non-streamlined: SCL-xxxxxNS and/or DA

---

## 2. Applicant

Fields:

- Name
- FCC Registration Number (FRN)

---

## 3. Attachment

Represents a binary file submitted as part of an Application or Comment.

---

## 4. Comment

---

## 5. Application Event

---
