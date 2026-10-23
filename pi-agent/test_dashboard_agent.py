"""Run with `python -m unittest test_dashboard_agent` from this directory —
stdlib only, like the agent itself."""

import unittest

import dashboard_agent as agent


class FakeDriver:
    def __init__(self):
        self.calls: list[bool] = []

    def set_power(self, on: bool) -> None:
        self.calls.append(on)


class FakeClock:
    def __init__(self):
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def make_panel():
    driver, clock = FakeDriver(), FakeClock()
    return agent.Panel(driver, clock=clock), driver, clock


class PanelTest(unittest.TestCase):
    def test_follows_the_schedule_switching_only_on_change(self):
        panel, driver, _ = make_panel()
        panel.set_schedule(True)
        panel.set_schedule(True)
        panel.set_schedule(False)
        self.assertEqual(driver.calls, [True, False])

    def test_touch_during_off_window_lights_the_panel_immediately(self):
        panel, driver, _ = make_panel()
        panel.set_schedule(False)
        panel.wake()
        self.assertEqual(driver.calls, [False, True])

    def test_wake_holds_through_schedule_polls_then_hands_back(self):
        panel, driver, clock = make_panel()
        panel.set_schedule(False)
        panel.wake()
        clock.now += agent.WAKE_OVERRIDE_SECONDS - 1
        panel.set_schedule(False)
        self.assertEqual(driver.calls, [False, True])
        clock.now += 2
        panel.set_schedule(False)
        self.assertEqual(driver.calls, [False, True, False])

    def test_touch_while_already_on_does_not_switch(self):
        panel, driver, _ = make_panel()
        panel.set_schedule(True)
        panel.wake()
        self.assertEqual(driver.calls, [True])

    def test_touch_before_first_schedule_poll_lights_the_panel(self):
        panel, driver, _ = make_panel()
        panel.wake()
        self.assertEqual(driver.calls, [True])


def event(ev_type: int, code: int, value: int) -> bytes:
    return agent.INPUT_EVENT.pack(0, 0, ev_type, code, value)


class ContainsPressTest(unittest.TestCase):
    BTN_TOUCH = 0x14A
    EV_ABS = 0x03
    EV_SYN = 0x00

    def test_finger_down_is_a_press(self):
        data = event(self.EV_ABS, 0x35, 500) + event(agent.EV_KEY, self.BTN_TOUCH, 1) + event(self.EV_SYN, 0, 0)
        self.assertTrue(agent.contains_press(data))

    def test_finger_up_and_movement_are_not(self):
        data = event(self.EV_ABS, 0x35, 500) + event(agent.EV_KEY, self.BTN_TOUCH, 0) + event(self.EV_SYN, 0, 0)
        self.assertFalse(agent.contains_press(data))

    def test_keyboard_keys_are_not(self):
        self.assertFalse(agent.contains_press(event(agent.EV_KEY, 30, 1)))  # KEY_A


if __name__ == "__main__":
    unittest.main()
