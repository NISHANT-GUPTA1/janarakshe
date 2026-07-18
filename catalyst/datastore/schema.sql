-- ============================================================================
-- Karnataka Police FIR System — relational schema
-- Source of truth: "DB schema — Entity Relationship Diagram" (KSP, Confidential)
--                  file: Police_FIR_ER_Diagram.pdf
--
-- Target: Catalyst Data Store (capability #6 — Relational database).
--
-- This is a faithful, 1:1 transcription of the provided ER diagram: every table,
-- column, primary key, foreign key and cardinality from the Relationship Matrix
-- is reproduced here. It is written in portable ANSI SQL so it can be imported
-- into Catalyst Data Store (create tables + relationship columns) or run against
-- any RDBMS for local development.
--
-- Catalyst Data Store notes:
--   * Every Catalyst table also auto-provisions ROWID (bigint PK), CREATEDTIME,
--     MODIFIEDTIME and CREATORID columns. The explicit *ID primary keys below are
--     kept as unique business keys so the ERD's foreign-key graph stays intact.
--   * In the Catalyst console, model each FK below as a "Lookup / relationship"
--     column pointing at the parent table.
--   * BIT flags are modelled as TINYINT (0/1). NVARCHAR(MAX) -> TEXT.
--
-- ERD note on Act/Section keys: the diagram lists Act.ActCode / Section.SectionCode
-- as VARCHAR primary keys but types the referencing columns (ActSectionAssociation
-- .ActID / .SectionID, CrimeHeadActSection) as INT. We follow the *relationship*
-- (FK -> ActCode / SectionCode) and keep the child columns VARCHAR so referential
-- integrity is valid; the ERD's INT annotation is preserved in comments.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Geography & organisation masters
-- ---------------------------------------------------------------------------

CREATE TABLE State (
    StateID        INT           NOT NULL,
    StateName      VARCHAR(120)  NOT NULL,
    NationalityID  INT,                                  -- Nationality reference ID
    Active         TINYINT       NOT NULL DEFAULT 1,     -- 1=Active, 0=Inactive
    PRIMARY KEY (StateID)
);

CREATE TABLE District (
    DistrictID    INT           NOT NULL,
    DistrictName  VARCHAR(120)  NOT NULL,
    StateID       INT           NOT NULL,               -- FK -> State
    Active        TINYINT       NOT NULL DEFAULT 1,
    PRIMARY KEY (DistrictID),
    FOREIGN KEY (StateID) REFERENCES State (StateID)
);

CREATE TABLE UnitType (
    UnitTypeID    INT           NOT NULL,
    UnitTypeName  VARCHAR(120)  NOT NULL,               -- e.g. Police Station, Circle Office
    CityDistState VARCHAR(20),                          -- Operational level: City / District / State
    Hierarchy     INT,                                  -- lower = higher authority
    Active        TINYINT       NOT NULL DEFAULT 1,
    PRIMARY KEY (UnitTypeID)
);

CREATE TABLE Unit (
    UnitID        INT           NOT NULL,
    UnitName      VARCHAR(180)  NOT NULL,               -- name of the unit / police station
    TypeID        INT,                                  -- FK -> UnitType.UnitTypeID
    ParentUnit    INT,                                  -- self-reference to Unit.UnitID (hierarchy)
    NationalityID INT,
    StateID       INT,                                  -- FK -> State
    DistrictID    INT,                                  -- FK -> District
    Active        TINYINT       NOT NULL DEFAULT 1,
    PRIMARY KEY (UnitID),
    FOREIGN KEY (TypeID)     REFERENCES UnitType (UnitTypeID),
    FOREIGN KEY (ParentUnit) REFERENCES Unit (UnitID),
    FOREIGN KEY (StateID)    REFERENCES State (StateID),
    FOREIGN KEY (DistrictID) REFERENCES District (DistrictID)
);

CREATE TABLE Rank (
    RankID    INT           NOT NULL,
    RankName  VARCHAR(120)  NOT NULL,                   -- e.g. Constable, Inspector, DSP
    Hierarchy INT,                                      -- lower = higher rank
    Active    TINYINT       NOT NULL DEFAULT 1,
    PRIMARY KEY (RankID)
);

CREATE TABLE Designation (
    DesignationID   INT           NOT NULL,
    DesignationName VARCHAR(120)  NOT NULL,             -- e.g. Investigating Officer, SHO
    Active          TINYINT       NOT NULL DEFAULT 1,
    SortOrder       INT,
    PRIMARY KEY (DesignationID)
);

CREATE TABLE Employee (
    EmployeeID          INT           NOT NULL,
    DistrictID          INT,                            -- FK -> District (current posting)
    UnitID              INT,                            -- FK -> Unit
    RankID              INT,                            -- FK -> Rank
    DesignationID       INT,                            -- FK -> Designation
    KGID                VARCHAR(40),                    -- Karnataka Government ID (unique)
    FirstName           VARCHAR(120),
    EmployeeDOB         DATE,
    GenderID            INT,                            -- lookup value
    BloodGroupID        INT,                            -- lookup value
    PhysicallyChallenged TINYINT     NOT NULL DEFAULT 0,-- 1=Yes, 0=No
    AppointmentDate     DATE,
    PRIMARY KEY (EmployeeID),
    FOREIGN KEY (DistrictID)    REFERENCES District (DistrictID),
    FOREIGN KEY (UnitID)        REFERENCES Unit (UnitID),
    FOREIGN KEY (RankID)        REFERENCES Rank (RankID),
    FOREIGN KEY (DesignationID) REFERENCES Designation (DesignationID)
);

CREATE TABLE Court (
    CourtID    INT           NOT NULL,
    CourtName  VARCHAR(200)  NOT NULL,
    DistrictID INT,                                     -- FK -> District
    StateID    INT,                                     -- FK -> State
    Active     TINYINT       NOT NULL DEFAULT 1,
    PRIMARY KEY (CourtID),
    FOREIGN KEY (DistrictID) REFERENCES District (DistrictID),
    FOREIGN KEY (StateID)    REFERENCES State (StateID)
);

-- ---------------------------------------------------------------------------
-- 2. Case classification & lookup masters
-- ---------------------------------------------------------------------------

CREATE TABLE CaseCategory (
    CaseCategoryID INT          NOT NULL,
    LookupValue    VARCHAR(60)  NOT NULL,               -- FIR, UDR, PAR, Zero FIR ...
    PRIMARY KEY (CaseCategoryID)
);

CREATE TABLE GravityOffence (
    GravityOffenceID INT          NOT NULL,
    LookupValue      VARCHAR(60)  NOT NULL,             -- Heinous, Non-Heinous ...
    PRIMARY KEY (GravityOffenceID)
);

CREATE TABLE CrimeHead (
    CrimeHeadID   INT           NOT NULL,
    CrimeGroupName VARCHAR(150) NOT NULL,               -- major head, e.g. Crimes Against Body
    Active        TINYINT       NOT NULL DEFAULT 1,
    PRIMARY KEY (CrimeHeadID)
);

CREATE TABLE CrimeSubHead (
    CrimeSubHeadID INT           NOT NULL,
    CrimeHeadID    INT           NOT NULL,              -- FK -> CrimeHead (parent major head)
    CrimeHeadName  VARCHAR(150)  NOT NULL,              -- sub-head, e.g. Murder, Robbery
    SeqID          INT,                                 -- display/sort sequence
    PRIMARY KEY (CrimeSubHeadID),
    FOREIGN KEY (CrimeHeadID) REFERENCES CrimeHead (CrimeHeadID)
);

CREATE TABLE Act (
    ActCode        VARCHAR(30)  NOT NULL,               -- e.g. IPC, NDPS, BNS
    ActDescription VARCHAR(255),
    ShortName      VARCHAR(120),
    Active         TINYINT      NOT NULL DEFAULT 1,
    PRIMARY KEY (ActCode)
);

CREATE TABLE Section (
    ActCode            VARCHAR(30)  NOT NULL,           -- FK -> Act.ActCode (parent act)
    SectionCode        VARCHAR(30)  NOT NULL,           -- e.g. 302, 307
    SectionDescription VARCHAR(255),
    Active             TINYINT      NOT NULL DEFAULT 1,
    PRIMARY KEY (ActCode, SectionCode),                 -- composite: section is unique within its act
    FOREIGN KEY (ActCode) REFERENCES Act (ActCode)
);

-- Maps a (CrimeHead, Act, Section) triple. Junction — no PK in the ERD.
CREATE TABLE CrimeHeadActSection (
    CrimeHeadID INT          NOT NULL,                  -- FK -> CrimeHead
    ActCode     VARCHAR(30)  NOT NULL,                  -- FK -> Act.ActCode
    SectionCode VARCHAR(30),                            -- section applicable to this crime head
    FOREIGN KEY (CrimeHeadID)         REFERENCES CrimeHead (CrimeHeadID),
    FOREIGN KEY (ActCode)             REFERENCES Act (ActCode),
    FOREIGN KEY (ActCode, SectionCode) REFERENCES Section (ActCode, SectionCode)
);

CREATE TABLE CaseStatusMaster (
    CaseStatusID   INT           NOT NULL,
    CaseStatusName VARCHAR(120)  NOT NULL,              -- Under Investigation, Charge Sheeted, Closed ...
    PRIMARY KEY (CaseStatusID)
);

-- ---------------------------------------------------------------------------
-- 3. Person demographic masters (referenced by ComplainantDetails)
-- ---------------------------------------------------------------------------

CREATE TABLE CasteMaster (
    caste_master_id   INT           NOT NULL,
    caste_master_name VARCHAR(120)  NOT NULL,
    PRIMARY KEY (caste_master_id)
);

CREATE TABLE ReligionMaster (
    ReligionID   INT           NOT NULL,
    ReligionName VARCHAR(120)  NOT NULL,                -- Hindu, Muslim, Christian ...
    PRIMARY KEY (ReligionID)
);

CREATE TABLE OccupationMaster (
    OccupationID   INT           NOT NULL,
    OccupationName VARCHAR(120)  NOT NULL,              -- Farmer, Government Employee ...
    PRIMARY KEY (OccupationID)
);

-- ---------------------------------------------------------------------------
-- 4. CaseMaster — the core FIR / case record
-- ---------------------------------------------------------------------------

CREATE TABLE CaseMaster (
    CaseMasterID       INT           NOT NULL,
    -- CrimeNo format: 1-digit Case Category Code + 4-digit District ID +
    -- 4-digit Police Station (Unit) ID + 4-digit Year + 5-digit running serial.
    -- e.g. FIR 104430006202600001, UDR 304430006202600001, Zero FIR 8..., PAR 4...
    CrimeNo            VARCHAR(30)   NOT NULL,
    -- CaseNo format: YYYY + 5-digit running serial (last 9 digits of CrimeNo), e.g. 202600001
    CaseNo             VARCHAR(15),
    CrimeRegisteredDate DATE,
    IncidentFromDate   DATETIME,                        -- start of the incident
    IncidentToDate     DATETIME,                        -- end of the incident
    InfoReceivedPSDate DATETIME,                        -- when the PS received information
    latitude           DECIMAL(9,6),                    -- GPS latitude of incident
    longitude          DECIMAL(9,6),                    -- GPS longitude of incident
    BriefFacts         TEXT,                            -- NVARCHAR(MAX) — case summary
    PolicePersonID     INT,                             -- FK -> Employee.EmployeeID (registering officer)
    PoliceStationID    INT,                             -- FK -> Unit.UnitID
    CaseCategoryID     INT,                             -- FK -> CaseCategory
    GravityOffenceID   INT,                             -- FK -> GravityOffence
    CrimeMajorHeadID   INT,                             -- FK -> CrimeHead.CrimeHeadID
    CrimeMinorHeadID   INT,                             -- FK -> CrimeSubHead.CrimeSubHeadID
    CaseStatusID       INT,                             -- FK -> CaseStatusMaster
    CourtID            INT,                             -- FK -> Court
    PRIMARY KEY (CaseMasterID),
    FOREIGN KEY (PolicePersonID)   REFERENCES Employee (EmployeeID),
    FOREIGN KEY (PoliceStationID)  REFERENCES Unit (UnitID),
    FOREIGN KEY (CaseCategoryID)   REFERENCES CaseCategory (CaseCategoryID),
    FOREIGN KEY (GravityOffenceID) REFERENCES GravityOffence (GravityOffenceID),
    FOREIGN KEY (CrimeMajorHeadID) REFERENCES CrimeHead (CrimeHeadID),
    FOREIGN KEY (CrimeMinorHeadID) REFERENCES CrimeSubHead (CrimeSubHeadID),
    FOREIGN KEY (CaseStatusID)     REFERENCES CaseStatusMaster (CaseStatusID),
    FOREIGN KEY (CourtID)          REFERENCES Court (CourtID)
);

-- One-to-one occurrence time/location detail per FIR (Relationship Matrix:
-- CaseMaster 1:1 Inv_OccuranceTime). Column set is not enumerated in the ERD;
-- modelled here as the occurrence time/place record keyed 1:1 to the case.
CREATE TABLE Inv_OccuranceTime (
    CaseMasterID       INT       NOT NULL,              -- PK & FK -> CaseMaster (1:1)
    IncidentFromDate   DATETIME,
    IncidentToDate     DATETIME,
    InfoReceivedPSDate DATETIME,
    latitude           DECIMAL(9,6),
    longitude          DECIMAL(9,6),
    PRIMARY KEY (CaseMasterID),
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster (CaseMasterID)
);

-- ---------------------------------------------------------------------------
-- 5. Case participants (children of CaseMaster)
-- ---------------------------------------------------------------------------

CREATE TABLE ComplainantDetails (
    ComplainantID  INT           NOT NULL,
    CaseMasterID   INT           NOT NULL,              -- FK -> CaseMaster
    ComplainantName VARCHAR(180),
    AgeYear        INT,
    OccupationID   INT,                                 -- FK -> OccupationMaster
    ReligionID     INT,                                 -- FK -> ReligionMaster
    CasteID        INT,                                 -- FK -> CasteMaster.caste_master_id
    GenderID       INT,                                 -- lookup value
    PRIMARY KEY (ComplainantID),
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster (CaseMasterID),
    FOREIGN KEY (OccupationID) REFERENCES OccupationMaster (OccupationID),
    FOREIGN KEY (ReligionID)   REFERENCES ReligionMaster (ReligionID),
    FOREIGN KEY (CasteID)      REFERENCES CasteMaster (caste_master_id)
);

CREATE TABLE Victim (
    VictimMasterID INT           NOT NULL,
    CaseMasterID   INT           NOT NULL,              -- FK -> CaseMaster
    VictimName     VARCHAR(180),
    AgeYear        INT,
    GenderID       INT,                                 -- lookup value (m, f, t)
    VictimPolice   VARCHAR(1),                          -- '1' if victim is police else '0'
    PRIMARY KEY (VictimMasterID),
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster (CaseMasterID)
);

CREATE TABLE Accused (
    AccusedMasterID INT          NOT NULL,
    CaseMasterID    INT          NOT NULL,              -- FK -> CaseMaster
    AccusedName     VARCHAR(180),
    AgeYear         INT,
    GenderID        INT,                                -- M / F / T
    PersonID        VARCHAR(10),                        -- accused sorting: A1, A2, A3 ...
    PRIMARY KEY (AccusedMasterID),
    FOREIGN KEY (CaseMasterID) REFERENCES CaseMaster (CaseMasterID)
);

-- Legal acts/sections invoked per case. Junction — no PK in the ERD.
CREATE TABLE ActSectionAssociation (
    CaseMasterID  INT          NOT NULL,                -- FK -> CaseMaster
    ActID         VARCHAR(30)  NOT NULL,               -- ERD: INT; FK -> Act.ActCode (VARCHAR)
    SectionID     VARCHAR(30),                          -- ERD: INT; FK -> Section.SectionCode (VARCHAR)
    ActOrderID    INT,                                  -- display/print order of the act
    SectionOrderID INT,                                 -- display/print order of the section
    FOREIGN KEY (CaseMasterID)     REFERENCES CaseMaster (CaseMasterID),
    FOREIGN KEY (ActID)            REFERENCES Act (ActCode),
    FOREIGN KEY (ActID, SectionID) REFERENCES Section (ActCode, SectionCode)
);

-- ---------------------------------------------------------------------------
-- 6. Arrest / surrender & chargesheet
-- ---------------------------------------------------------------------------

CREATE TABLE ArrestSurrender (
    ArrestSurrenderID        INT     NOT NULL,
    CaseMasterID             INT     NOT NULL,          -- FK -> CaseMaster
    ArrestSurrenderTypeID    INT,                       -- lookup: arrest / surrender
    ArrestSurrenderDate      DATE,
    ArrestSurrenderStateId   INT,                       -- FK -> State
    ArrestSurrenderDistrictId INT,                      -- FK -> District
    PoliceStationID          INT,                       -- FK -> Unit.UnitID
    IOID                     INT,                       -- FK -> Employee.EmployeeID (Investigating Officer)
    CourtID                  INT,                       -- FK -> Court
    AccusedMasterID          INT,                       -- FK -> Accused
    IsAccused                TINYINT,                   -- 0/1 primary accused
    IsComplainantAccused     TINYINT,                   -- 0/1 complainant also accused
    PRIMARY KEY (ArrestSurrenderID),
    FOREIGN KEY (CaseMasterID)            REFERENCES CaseMaster (CaseMasterID),
    FOREIGN KEY (ArrestSurrenderStateId)  REFERENCES State (StateID),
    FOREIGN KEY (ArrestSurrenderDistrictId) REFERENCES District (DistrictID),
    FOREIGN KEY (PoliceStationID)         REFERENCES Unit (UnitID),
    FOREIGN KEY (IOID)                    REFERENCES Employee (EmployeeID),
    FOREIGN KEY (CourtID)                 REFERENCES Court (CourtID),
    FOREIGN KEY (AccusedMasterID)         REFERENCES Accused (AccusedMasterID)
);

-- Junction: one arrest/surrender event links to many accused persons.
CREATE TABLE inv_arrestsurrenderaccused (
    ArrestSurrenderID INT NOT NULL,                     -- FK -> ArrestSurrender
    AccusedMasterID   INT NOT NULL,                     -- FK -> Accused
    PRIMARY KEY (ArrestSurrenderID, AccusedMasterID),
    FOREIGN KEY (ArrestSurrenderID) REFERENCES ArrestSurrender (ArrestSurrenderID),
    FOREIGN KEY (AccusedMasterID)   REFERENCES Accused (AccusedMasterID)
);

CREATE TABLE ChargesheetDetails (
    CSID           INT       NOT NULL,
    CaseMasterID   INT       NOT NULL,                  -- FK -> CaseMaster
    csdate         DATETIME,                            -- chargesheeted date
    cstype         CHAR(1),                             -- A=Chargesheet, B=False Case, C=Undetected
    PolicePersonID INT,                                 -- FK -> Employee.EmployeeID
    PRIMARY KEY (CSID),
    FOREIGN KEY (CaseMasterID)   REFERENCES CaseMaster (CaseMasterID),
    FOREIGN KEY (PolicePersonID) REFERENCES Employee (EmployeeID)
);
