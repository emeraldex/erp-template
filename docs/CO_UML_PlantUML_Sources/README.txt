COMPANY NAME SDN. BHD. (the Company)
UML Diagram Sources — PlantUML (.puml)
Companion to CO-RFP-IT-001 (Business Workflow & System Requirements Specification)
=====================================================================================

CONTENTS
--------
Four diagram sets covering the nine Section 5 business processes (5.1 - 5.9):

  01_sequence/   UML sequence diagrams   (_style.iuml    + 51..59)
  02_usecase/    UML use case diagrams   (_ucstyle.iuml  + 51..59)
  03_activity/   UML activity diagrams   (_astyle.iuml   + 51..59)
  04_class/      UML class diagrams      (_cstyle.iuml   + 51..59)

File-to-process map (same in every folder):
  51  = 5.1  Master Job / Component Lifecycle (JTS)                   (QP.44)
  52  = 5.2  Component Maintenance and Service                        (QP.17 / QP.17A)
  53  = 5.3  Parts Procurement and Verification                      (QP.14)
  54  = 5.4  Outside Vendor (OV) Repair                              (QP.33)
  55  = 5.5  Supplier / Vendor Selection & Reassessment             (QP.13)
  56  = 5.6  Sub-Contractor / Vendor Selection & Reassessment       (QP.34)
  57  = 5.7  Foreign Object Control (FOD) & Quality Compliance      (QP.46)
  58  = 5.8  Invoicing & Revenue Billing                            (QP.51)
  59  = 5.9  AOG / ROA / Critical Priority Handling                 (QP.56)

Each folder contains a shared style include (the _*.iuml file) that the diagrams
pull in via "!include". Keep each style file in the same folder as its diagrams
so the include resolves.

REQUIREMENTS
------------
- Java 8+ (these were produced with OpenJDK 21).
- PlantUML (produced with PlantUML v1.2024.7). Download the jar from:
  https://plantuml.com/download  or  https://github.com/plantuml/plantuml/releases
- Graphviz "dot" is required for use case, activity and class diagrams
  (sequence diagrams do not need it). Install from https://graphviz.org/download/

RENDER
------
From within a folder (so the !include resolves), for example:

  # PNG (all diagrams in the folder)
  java -jar plantuml.jar -tpng *.puml

  # SVG (vector, recommended for crisp scaling in documents)
  java -jar plantuml.jar -tsvg *.puml

  # Higher-resolution PNG
  java -jar plantuml.jar -tpng -Sdpi=200 *.puml

  # A single diagram
  java -jar plantuml.jar -tpng 52_maintenance.puml

Tip: the resolutions used for the delivered Word documents were
sequence 140 dpi, use case 130 dpi, activity 200 dpi, class 150 dpi.

EDITING
-------
- Colours/fonts are centralised in each folder's _*.iuml style file; edit once
  to restyle a whole set.
- Message text, participants, actions, decisions and relationships are in the
  individual .puml files and can be edited freely.
- Live preview is available in VS Code (PlantUML extension), IntelliJ, or at
  https://www.plantuml.com/plantuml (paste a .puml; inline the style file first).

NOTE
----
These diagrams are derived from the Company controlled Quality Procedures. Where a
diagram and the controlled procedure differ, the procedure prevails.
