"""Serial dilution across row A of a 96-well plate with an 8-channel pipette.

Rebuilt from the robot's analysis of the original test_opentron_file.py, with
the deck rearranged: reservoir D3 -> D2, tip racks D2/C2 -> B3/C3. Every
volume, height and flow rate matches the original run step for step.
"""
from opentrons import protocol_api

metadata = {"protocolName": "test_opentron_file", "description": "Serial dilution, row A (rearranged deck)"}
requirements = {"robotType": "Flex", "apiLevel": "2.15"}  # 2.15: fixed trash in A3, like the original

FLOW = 716.0  # uL/s for aspirate, dispense and blow-out
RESERVOIR_Z = -23.85  # mm below the reservoir well top
PLATE_DISPENSE_Z = -8.67  # mm below the plate well top
PLATE_ASPIRATE_Z = -7.67


def run(protocol: protocol_api.ProtocolContext):
    tips_1 = protocol.load_labware("opentrons_flex_96_filtertiprack_200ul", "B3")
    tips_2 = protocol.load_labware("opentrons_flex_96_filtertiprack_200ul", "C3")
    plate = protocol.load_labware("corning_96_wellplate_360ul_flat", "D1")
    reservoir = protocol.load_labware("nest_12_reservoir_15ml", "D2")
    pipette = protocol.load_instrument("flex_8channel_1000", "left", tip_racks=[tips_1, tips_2])
    pipette.flow_rate.aspirate = pipette.flow_rate.dispense = pipette.flow_rate.blow_out = FLOW
    row = plate.rows()[0]

    # 100 uL diluent from reservoir A1 into columns 2-12, one tip
    pipette.pick_up_tip()
    for well in row[1:]:
        pipette.aspirate(100, reservoir["A1"].top(RESERVOIR_Z))
        pipette.dispense(100, well.top(PLATE_DISPENSE_Z))
        pipette.blow_out(well.top())
    pipette.drop_tip()

    # 200 uL solution from reservoir A2 into column 1
    pipette.pick_up_tip()
    pipette.aspirate(200, reservoir["A2"].top(RESERVOIR_Z))
    pipette.dispense(200, row[0].top(PLATE_DISPENSE_Z))
    pipette.blow_out(row[0].top())
    pipette.drop_tip()

    # dilute down the row: 100 uL from each column into the next, mix 3 x 80 uL
    for source, dest in zip(row[:-1], row[1:]):
        pipette.pick_up_tip()
        pipette.aspirate(100, source.top(PLATE_ASPIRATE_Z))
        pipette.dispense(100, dest.top(PLATE_DISPENSE_Z))
        for _ in range(3):
            pipette.aspirate(80, dest.top(PLATE_ASPIRATE_Z))
            pipette.dispense(80, dest.top(PLATE_ASPIRATE_Z))
        pipette.blow_out(dest.top())
        pipette.drop_tip()

    # remove 100 uL from column 12 so every column ends with the same volume
    pipette.pick_up_tip()
    pipette.aspirate(100, row[-1].top(PLATE_ASPIRATE_Z))
    pipette.drop_tip()
