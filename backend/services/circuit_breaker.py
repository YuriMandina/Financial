from datetime import datetime, timedelta

class OmieCircuitBreaker:
    def __init__(self):
        self.consecutive_failures = 0
        self.paused_until = None
        self.state = "CLOSED" # CLOSED = Ok, OPEN = Blocked
        
    def record_failure(self, msg, penalty_seconds=None):
        if penalty_seconds:
            self.paused_until = datetime.now() + timedelta(seconds=penalty_seconds)
            self.state = "OPEN"
            self.consecutive_failures = 0
            return
            
        if "106" in msg or "105" in msg or "SOAP" in msg:
            self.consecutive_failures += 1
            if self.consecutive_failures >= 3:
                self.paused_until = datetime.now() + timedelta(seconds=120)
                self.state = "OPEN"
                self.consecutive_failures = 0
        else:
            # Erros genéricos de conexão não contam como penalidade da Omie
            pass
        
    def record_success(self):
        self.consecutive_failures = 0
        self.state = "CLOSED"
        self.paused_until = None
        
    def is_open(self):
        if self.state == "OPEN":
            if self.paused_until and datetime.now() > self.paused_until:
                self.state = "CLOSED"
                self.paused_until = None
                return False
            return True
        return False
        
    def time_remaining(self):
        if self.is_open() and self.paused_until:
            return int((self.paused_until - datetime.now()).total_seconds())
        return 0

circuit_breaker = OmieCircuitBreaker()
