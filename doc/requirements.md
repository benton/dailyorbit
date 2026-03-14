# FCC IBFS Explorer Requirements

## 1. Project Information

This codebase provides a web-based interface for exploring the publicly filed Applications to the US Federal Communications Commission's International Bureau Filing System (IBFS). The IBFS is a database, application filing system, and processing system, hosted by the US federal government, for all International and Satellite services.

---

## 2. Objectives/Goals

The main purpose of this software is to provide its users deep insights into the competitive landscape of the satellite communications industry, and the legal issues that inform it. To that end, the tool offers a personalized, web-based interface for exploring the data provided by IBFS: the Applications, the entities who filed or commented on them, and the documents associated with them. Specific view pages for individial Applications, Applicants, and other entities are provided to help the user understand the overall picture and provide actionable data.

The target users for this product are attorneys, paralegals, and other business and legal strategists who require a self-service interface for keeping abreast of relevant industry developments.

---

## 3. Assumptions & Constraints

Users of this software will require a user account. The account will be used to track which Applications, Comments, Events, and News Articles have already been seen by the user, so that any new information can be prominently and promptly surfaced.

---

## 4. Background & Strategic Fit

Keeping abreast of legal developments in the satellite communications industry is critical to the companies involved. Since the number of posible physical satellite orbits is limited, as is the number of non-overlapping frequency bands licensed for talking to them, _both_ of these resources are effectively scarce, and the firms compete aggressively for frequency and orbital licenses.

Currently, this application is focused on providing insight into the contents of the Space and Earth Station Applications, plus their Comments and Attachments. But as this software evolves, it may incorporate more and more types of IBFS Applications.

---

## 5. User Stories

**NOTE:**
This web-based application is built from separate backend _(server-side)_ and frontend _(in-browser)_ codebases. While the following User stories reference the browser interface, all of the described stories must also be available via a high-level, RESTful API. Further, the frontend must consume this API in a way that reflects the user's actions as simply and clearly as possible.

### 5.1 Login features

Unauthenticated requests should be redirected to the company Office 365 login page, with the OpenID redirect URL set to the user's original request URL.

User accounts are primarily identified by email address, as set by the OpenID email field.
A User may not log in until their account exists in the database.
Each User account stores a boolean flag indicating whether the account is an administrator.

### 5.2 User Dashboard

Displays new or highly relevant information to the User based on their expressed preferences and/or past behavior.
The format is that of a 1930s "Golden Age of Newsprint" broadsheet newspaper.

### 5.3 Application View

Provides an overview of a given Application:

- A summary of what the application is for and who filed it
- A timeline of events for this Appliction, highlighting where it sits in the FCC approval process
- A list of the comments that have been filed for this application, including who filed each
- A summary of the content of all comments, taken as a whole

#### 5.4 Applicant View

Provides an overview of a given Applicant: their overall activity level, recent actions, and possibly a summary of their overall competitive position.

### 5.5 Page Heading Navigation

The site's page header should include "breadcrumb"-style navigation links that mirror the

### 5.6 Detailed Search Interface

### 5.7 Content Summarization and Analysis

---

## 6. Admin Stories

### 6.1 Data scraping

The `daily-orbit data` CLI command provides a `scrape` command which accepts one or more arguments specifying the date of the data set to fetch from the FCC feed. The default is to download the latest data set. Both metadata and binary attachments are downloaded, and the full text or any attachments is extracted and indexed for search.

### 6.2 Admin Login features

The Administrative UI is accessible at the URL path `/admin`.
Unauthorized requests to the administrative UI should be redirected to the User Dashboard page.
Authorized admin Users should be redirected to the originally requested URL, or the administrative UI.

The main administrative landing page should summarize the data set: its size, time and scope of last update, etc.
It should also contain controls for the re-invoking the app's summarization processes.

### 6.8 Configuration stories

When running in development mode, the application should load configuration from `.env` files.
When deployed to Kubernetes, the application should load its configuration from Kubernetes resources.

#### 6.8.1 S3 Storage Configuration

The application stores structured data in its relational (PostgreSQL) database.
Attachments and other binary blobs are stored at a URL that points either to the local filesystem or to an S3-compatible object storage service.

---

## 7. Data Model

The application's data model is outlined in [datamodel.md](datamodel.md).

---

## 8. Release Criteria

Before release of any major or minor version, the software must pass all tests in the test suite, which includes unit tests and integration tests.
